/*
 * DERMA-SHIELD · MainActivity.kt
 * ------------------------------
 * Single Capacitor host activity. Registers the two custom native plugins
 * (UvLuxBarometer, DermatoscopyCamera) before `super.onCreate` so the WebView
 * bridge can resolve them on first call, and forwards hardware volume-key
 * presses to the JS timer layer (long-press = reset the MED countdown).
 */
package com.dermashield.bio

import android.os.Bundle
import android.view.KeyEvent
import com.getcapacitor.BridgeActivity
import com.getcapacitor.PluginHandle

class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(UvLuxBarometerPlugin::class.java)
        registerPlugin(DermatoscopyCameraPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    /** Volume-down long press resets the dosimetry timers without unlocking. */
    override fun onKeyLongPress(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
            bridge?.webView?.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('dermashield:key',{detail:{action:'resetTimers'}}))",
                null
            )
            return true
        }
        return super.onKeyLongPress(keyCode, event)
    }

    /** Expose plugin handles to the WebView for diagnostics. */
    fun uvLuxPlugin(): UvLuxBarometerPlugin? =
        bridge?.getPlugin("UvLuxBarometer")?.let { handle ->
            (handle as? PluginHandle)?.instance as? UvLuxBarometerPlugin
        }

    fun cameraPlugin(): DermatoscopyCameraPlugin? =
        bridge?.getPlugin("DermatoscopyCamera")?.let { handle ->
            (handle as? PluginHandle)?.instance as? DermatoscopyCameraPlugin
        }
}
