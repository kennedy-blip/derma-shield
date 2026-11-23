/*
 * DERMA-SHIELD · UvLuxBarometerPlugin.kt
 * -----------------------------------------------------------------------------
 * Native Android Capacitor plugin that exposes the three hardware sensors the
 * offline solar dosimeter needs:
 *
 *   TYPE_LIGHT            Illuminance in lux. Feeds the empirical lux → UV Index
 *                         fallback (sin(elevation)^2.4 gate) when no network or
 *                         weather service is available on the beach.
 *
 *   TYPE_PRESSURE         Barometric pressure in hPa → ISA altitude
 *                         h = 44330 · (1 − (p/p₀)^0.1903). Every 300 m of
 *                         altitude raises UV by ~4 %, so a precise altitude is
 *                         what makes an alpine reading trustworthy.
 *
 *   TYPE_ROTATION_VECTOR  Quaternion → pitch/roll/heading, used to drive
 *                         William's shadow-ratio clinometer (aim the phone at the
 *                         shadow tip; α = 90° − |pitch|) and the gyro specular
 *                         lighting on the glass UI.
 *
 * Design notes
 *  - SensorManager is obtained from the application context and listeners are
 *    registered on a dedicated HandlerThread, so sensor storms never block the
 *    WebView UI thread.
 *  - Readings are coalesced to `intervalMs` (default 900 ms) before crossing the
 *    Capacitor bridge; the JS side only needs ~1 Hz and each bridge call costs
 *    ~0.4 ms.
 *  - Every capability is independently optional: a device without a
 *    barometer still reports lux and orientation, and the plugin reports which
 *    channels are actually delivering (`sensors` array in the payload).
 *  - All sensors are unregistered in `handleOnDestroy` and on `stop()`, because a
 *    leaked SensorEventListener in a sun-exposed app is a thermal and battery
 *    hazard.
 */

package com.dermashield.bio

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sqrt

@CapacitorPlugin(name = "UvLuxBarometer")
class UvLuxBarometerPlugin : Plugin(), SensorEventListener {

    companion object {
        private const val TAG = "UvLuxBarometer"
        private const val EVENT_NAME = "sensorUpdate"

        /** Standard gravity and ISA reference pressure. */
        private const val SEA_LEVEL_HPA = 1013.25
        private const val SCALE_HEIGHT_M = 8434.0

        /** Clamp: no meaningful UVB below ~−200 m, and >9 000 m is not a beach. */
        private const val MIN_ALTITUDE_M = -200.0
        private const val MAX_ALTITUDE_M = 9000.0

        /** Lux above which the sensor may be saturating (direct sun ~120 klx). */
        private const val LUX_SATURATION = 150_000f
    }

    private var sensorManager: SensorManager? = null
    private var lightSensor: Sensor? = null
    private var pressureSensor: Sensor? = null
    private var rotationSensor: Sensor? = null

    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    private var intervalMs: Long = 900
    private var lastEmit: Long = 0

    // latest raw values
    private var lux: Float = Float.NaN
    private var pressureHpa: Float = Float.NaN
    private var altitudeM: Double = Double.NaN
    private var pitchDeg: Float = 0f
    private var rollDeg: Float = 0f
    private var headingDeg: Float = 0f

    private var running = false
    private val rotationMatrix = FloatArray(9)
    private val orientation = FloatArray(3)

    // Reused to avoid per-reading allocation (sensors fire fast).
    private val payload = JSObject()

    override fun load() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        lightSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_LIGHT)
        pressureSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_PRESSURE)
        rotationSensor =
            sensorManager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                ?: sensorManager?.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)

        handlerThread = HandlerThread("dermashield-sensors").also { it.start() }
        handler = Handler(handlerThread!!.looper)
        running = true

        sensorManager?.let { manager ->
            lightSensor?.let {
                manager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI, handler)
            }
            pressureSensor?.let {
                manager.registerListener(this, it, SensorManager.SENSOR_DELAY_UI, handler)
            }
            rotationSensor?.let {
                manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, handler)
            }
        }
    }

    /**
     * Start streaming. `intervalMs` coalesces bridge traffic; the sensor
     * sampling rate itself stays at SENSOR_DELAY_UI/GAME for responsiveness of
     * the clinometer.
     */
    @PluginMethod
    fun start(call: PluginCall) {
        intervalMs = (call.getInt("intervalMs") ?: 900).toLong().coerceIn(120L, 10_000L)
        running = true

        // Re-register if the sensors were stopped.
        if (sensorManager != null && lightSensor != null) {
            sensorManager?.registerListener(
                this, lightSensor, SensorManager.SENSOR_DELAY_UI, handler
            )
        }
        if (sensorManager != null && rotationSensor != null) {
            sensorManager?.registerListener(
                this, rotationSensor, SensorManager.SENSOR_DELAY_GAME, handler
            )
        }

        call.resolve(
            JSObject().apply {
                put("started", true)
                put("intervalMs", intervalMs)
                put("sensors", availableSensorNames())
                put("hasLight", lightSensor != null)
                put("hasPressure", pressureSensor != null)
                put("hasRotation", rotationSensor != null)
            }
        )
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
        sensorManager?.unregisterListener(this)
        call.resolve(JSObject().apply { put("stopped", true) })
    }

    /** One-shot snapshot for the UI to render before the first event lands. */
    @PluginMethod
    fun readOnce(call: PluginCall) {
        call.resolve(buildPayload())
    }

    /**
     * Convert a raw pressure to ISA altitude. Exposed so the JS layer can do the
     * same math for manual pressure entry (and so it is testable).
     */
    @PluginMethod
    fun altitudeFromPressure(call: PluginCall) {
        val hPa = call.getDouble("pressureHpa") ?: run {
            call.reject("pressureHpa is required")
            return
        }
        val seaLevel = call.getDouble("seaLevelHpa") ?: SEA_LEVEL_HPA
        val ratio = hPa / seaLevel
        val altitude = SCALE_HEIGHT_M * (1.0 - ratio.pow(0.1903))
        call.resolve(
            JSObject().apply {
                put("altitudeM", altitude.coerceIn(MIN_ALTITUDE_M, MAX_ALTITUDE_M))
                put("pressureHpa", hPa)
                put("seaLevelHpa", seaLevel)
            }
        )
    }

    /** Shadow clinometer from an explicit pitch/roll pair (no sensor needed). */
    @PluginMethod
    fun elevationFromTilt(call: PluginCall) {
        val pitch = call.getDouble("pitchDeg") ?: 0.0
        val roll = call.getDouble("rollDeg") ?: 0.0
        val combined = sqrt(pitch * pitch + (roll * 0.35) * (roll * 0.35)).coerceAtMost(90.0)
        call.resolve(
            JSObject().apply {
                put("elevationDeg", (90.0 - combined).coerceAtLeast(0.0))
                put("combinedTiltDeg", combined)
            }
        )
    }

    // ------------------------------------------------------------------ sensor
    override fun onSensorChanged(event: SensorEvent) {
        if (!running) return

        when (event.sensor.type) {
            Sensor.TYPE_LIGHT -> {
                lux = event.values[0]
            }
            Sensor.TYPE_PRESSURE -> {
                pressureHpa = event.values[0]
                if (pressureHpa > 300f && pressureHpa < 1100f) {
                    altitudeM = SCALE_HEIGHT_M * (1.0 - (pressureHpa / SEA_LEVEL_HPA).toDouble().pow(0.1903))
                }
            }
            Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                SensorManager.getOrientation(rotationMatrix, orientation)
                // orientation = [azimuth, pitch, roll] in radians
                headingDeg = ((Math.toDegrees(orientation[0].toDouble()) + 360.0) % 360.0).toFloat()
                pitchDeg = Math.toDegrees(orientation[1].toDouble()).toFloat()
                rollDeg = Math.toDegrees(orientation[2].toDouble()).toFloat()
            }
        }

        val now = SystemClock.elapsedRealtime()
        if (now - lastEmit < intervalMs) return
        lastEmit = now
        notifyListeners(EVENT_NAME, buildPayload())
    }

    private fun buildPayload(): JSObject {
        // fresh object per emit: notifyListeners retains the JSObject
        val out = JSObject()
        val sensors = ArrayList<String>()

        if (!lux.isNaN()) {
            sensors.add("TYPE_LIGHT")
            out.put("lux", lux.toDouble())
            out.put("luxSaturated", lux >= LUX_SATURATION)
        }
        if (!pressureHpa.isNaN()) {
            sensors.add("TYPE_PRESSURE")
            out.put("pressureHpa", pressureHpa.toDouble())
            if (!altitudeM.isNaN()) {
                out.put("altitudeM", altitudeM.coerceIn(MIN_ALTITUDE_M, MAX_ALTITUDE_M))
            }
        }
        if (rotationSensor != null) {
            sensors.add("TYPE_ROTATION_VECTOR")
            out.put("pitchDeg", pitchDeg.toDouble())
            out.put("rollDeg", rollDeg.toDouble())
            out.put("headingDeg", headingDeg.toDouble())
            // William's shadow-ratio clinometer assumption: resting flat along the
            // shadow, elevation = 90° − |pitch|.
            out.put("shadowElevationDeg", (90.0 - abs(pitchDeg.toDouble())).coerceAtLeast(0.0))
        }

        out.put("sensors", sensors.toTypedArray())
        out.put("deviceModel", Build.MODEL ?: "unknown")
        out.put("sdkInt", Build.VERSION.SDK_INT)
        out.put("lowGpuTier", Build.VERSION.SDK_INT < 31)
        out.put("timestampMs", System.currentTimeMillis())
        out.put("backend", "NATIVE KOTLIN")
        return out
    }

    private fun availableSensorNames(): Array<String> {
        val names = ArrayList<String>()
        lightSensor?.let { names.add(it.name) }
        pressureSensor?.let { names.add(it.name) }
        rotationSensor?.let { names.add(it.name) }
        return names.toTypedArray()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not clinically meaningful for lux/pressure/orientation fusion.
    }

    override fun handleOnDestroy() {
        running = false
        sensorManager?.unregisterListener(this)
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
        super.handleOnDestroy()
    }
}
