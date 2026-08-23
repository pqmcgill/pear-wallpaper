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

export function stageSharedImage (uri) {
  const dir = new Directory(Paths.document, STAGING_DIR_NAME)
  if (!dir.exists) dir.create()

  const dest = new File(dir, `${Date.now()}.${extensionOf(uri)}`)
  const source = new File(uri)
  source.copy(dest)

  // Strip the file:// scheme, same idiom as worklet-client.js's
  // documentsPath() — sendWallpaper's filePath (and Bare's fs underneath
  // it) wants a plain path, not a URI.
  return dest.uri.replace(/^file:\/\//, '')
}
