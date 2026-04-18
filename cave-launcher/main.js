const { app, BrowserWindow } = require("electron");

function createWindows() {
  const screenWidth = 3840 / 8;
  const screenHeight = 2160 / 8;

  const positionX = 3840 / 4;
  const positionY = 0;

  // screens in index.html: 0=Left, 1=Front, 2=Right, 3=Back, 4=Bottom
  const screenConfigs = [
    { name: "Left", x: positionX + screenWidth, y: positionY }, // index 0
    { name: "Front", x: positionX - screenWidth * 2, y: positionY }, // index 1
    { name: "Right", x: positionX - screenWidth, y: positionY }, // index 2
    { name: "Back", x: positionX, y: positionY }, // index 3
    { name: "Bottom", x: positionX + screenWidth * 2, y: positionY }, // index 4
  ];

  screenConfigs.forEach((config, i) => {
    const win = new BrowserWindow({
      x: config.x,
      y: config.y,
      width: screenWidth,
      height: screenHeight,
      frame: false,
      transparent: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    win.loadURL(
      `http://localhost:8080/examples/cave-5-screens/index.html?screen=${i}`,
    );
  });
}

app.dock.hide();

app.whenReady().then(() => {
  createWindows();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
