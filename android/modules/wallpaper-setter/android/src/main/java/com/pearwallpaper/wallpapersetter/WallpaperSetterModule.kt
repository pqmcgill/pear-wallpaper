package com.pearwallpaper.wallpapersetter

import android.app.WallpaperManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

class WallpaperSetterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WallpaperSetter")
    // setStream, not setBitmap: the image streams straight to the wallpaper
    // service without materializing a full Bitmap in our heap.
    AsyncFunction("setWallpaper") { filePath: String, target: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
      val wm = WallpaperManager.getInstance(ctx)
      val flags = when (target) {
        "home" -> WallpaperManager.FLAG_SYSTEM
        "lock" -> WallpaperManager.FLAG_LOCK
        else -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
      }
      val file = File(filePath)
      if (!file.exists()) throw IllegalArgumentException("no such file: $filePath")
      FileInputStream(file).use { stream ->
        val id = wm.setStream(stream, null, true, flags)
        if (id == 0) throw IllegalStateException("WallpaperManager.setStream returned 0")
      }
      true
    }
  }
}
