import { File, Paths, Directory } from 'expo-file-system'

// Android's share sheet hands expo-share-intent a reference to the shared
// image that is NOT guaranteed to be a plain filesystem path — utils.js in
// the installed expo-share-intent@6.1.1 populates shareIntent.files[].path
// from whichever of `file.path`, `file://${file.filePath}`, or
// `file.contentUri` the native module reported, and the last of those is a
// genuine `content://` URI (a SAF/ContentResolver-backed reference, scoped
// to this app's grant on it). The worklet's Bare `fs` binding
// (core/index.js's `fs.promises.readFile(image)`, called from the Bare-side
// JS realm) has no ContentResolver access at all — a content:// URI handed
// to it fails outright. expo-file-system's File/Directory classes run on
// the RN side, where the app's SAF grant is live, and CAN read a content://
// URI — so this copy step (same "materialize before the worklet ever sees
// it" idiom as worklet-client.js's documentsPath()) is what turns an
// ephemeral, permission-scoped reference into a plain file both Bare's fs
// and core.sendWallpaper()'s readFile() can open directly.
const STAGING_DIR_NAME = 'pear-wallpaper-staging'

function extensionOf (uri) {
  // Strip any query/fragment before matching — a content:// URI's own path
  // segment often has no extension at all (e.g. a raw MediaStore row id);
  // 'jpg' is a reasonable default for a screen that only ever stages images.
  const clean = uri.split('?')[0].split('#')[0]
  const match = /\.([a-zA-Z0-9]+)$/.exec(clean)
  return match ? match[1] : 'jpg'
}

function randomSuffix () {
  // 6 base36 chars, collision-guarding the filename against a second share
  // landing in the same millisecond (Date.now() alone isn't a safe key).
  // padEnd guards the (very rare) case where the fractional digits of
  // Math.random() run out before slice(2, 8) has 6 of them to take.
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0')
}

export function stageSharedImage (uri) {
  const dir = new Directory(Paths.document, STAGING_DIR_NAME)
  if (!dir.exists) dir.create()

  // Reap before staging the new file: only one share flows through this
  // screen at a time, and core.sendWallpaper() copies the sent image into
  // its own hyperblobs storage as soon as it runs — so anything already
  // sitting in the staging dir is dead weight. It's either a file
  // send.js's own post-send cleanup already should have removed (this is
  // the backstop for that failing), or one orphaned by a Send screen that
  // was abandoned before Send was ever pressed. Reaping here, on the next
  // share, catches both cases even if the app was killed in between.
  for (const entry of dir.list()) {
    entry.delete()
  }

  const dest = new File(dir, `${Date.now()}-${randomSuffix()}.${extensionOf(uri)}`)
  const source = new File(uri)
  source.copy(dest)

  // Strip the file:// scheme, same idiom as worklet-client.js's
  // documentsPath() — sendWallpaper's filePath (and Bare's fs underneath
  // it) wants a plain path, not a URI.
  return dest.uri.replace(/^file:\/\//, '')
}

// Called by send.js right after a successful sendWallpaper() call — core
// already has its own copy of the image in hyperblobs by that point, so the
// staged file is dead weight. Kept as its own export (rather than inlining
// `new File(...).delete()` in send.js) so the file:// re-prefixing idiom
// lives in one place next to stageSharedImage's stripping of it.
export function deleteStagedFile (filePath) {
  new File('file://' + filePath).delete()
}
