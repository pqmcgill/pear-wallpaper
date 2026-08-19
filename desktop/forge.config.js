module.exports = {
  packagerConfig: { name: 'Pear Wallpaper', asar: true },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }]
}
