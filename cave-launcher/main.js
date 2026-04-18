const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const http = require("node:http");

// ----- Bridge Server for Mobile remote -----
let commandState = { url: null, isPaged: null, timestamp: 0 };
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }

  if (req.url === "/api/command" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        commandState = { url: payload.url, isPaged: payload.isPaged, timestamp: Date.now() };
        console.log("[Bridge] Mobile dispatched scene:", commandState.url);
      } catch (e) { }
      res.writeHead(200); res.end("ok");
    });
  } else if (req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(commandState));
  } else {
    res.writeHead(404); res.end();
  }
}).listen(3000, "0.0.0.0", () => console.log("CAVE Mobile Relay listening on port 3000"));
// ------------------------------------------

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
