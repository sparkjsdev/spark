# Distance Measurement & Rescale Usage Guide

## Access

**URL**: [https://nice-meadow-018297c00.eastasia.6.azurestaticapps.net/examples/distance-rescale/](https://nice-meadow-018297c00.eastasia.6.azurestaticapps.net/examples/distance-rescale/)

---

## Overview

Measure distances between two points on a 3D Gaussian Splatting (3DGS) model and rescale the model to match real-world dimensions. Features include coordinate system visualization, custom origin setting, and flexible file loading.

---

## Usage

### 1. Loading 3DGS Files

You can load files in three ways:

**Option A: Load Button**
1. Click the **"Load PLY File"** button in the Controls panel (top-right)
2. Select a `.ply`, `.spz`, or `.splat` file from the dialog
3. The model loads automatically and the camera adjusts

**Option B: Drag & Drop**
1. Drag a `.ply`, `.spz`, or `.splat` file from your file explorer
2. Drop it directly onto the 3D canvas
3. The model loads automatically

**Option C: Default Model**
- A penguin model loads by default when you first open the page

### 2. Coordinate Axes Display

1. Click the **"Toggle Axes"** button in the Controls panel
2. Red (X), Green (Y), Blue (Z) axes appear from the origin (0,0,0)
3. Click again to hide the axes

### 3. Setting a New Origin

1. Right double-click on any point of the model
2. The model geometry transforms so that point becomes the new origin (0,0,0)
3. The coordinate axes (if visible) mark the new origin
4. All previous measurements are cleared

**Tips:**
- The camera position adjusts to maintain your view
- You can set multiple new origins by right double-clicking different points
- Exported PLY files include the transformed coordinates

### 4. Placing Measurement Points

1. **First point**: Left-click anywhere on the model (green marker appears)
2. **Second point**: Left-click another location (blue marker appears)
3. A yellow line connects the points and displays the distance

### 5. Adjusting Measurement Points

- Drag any marker to adjust its position along the view direction
- The distance updates in real-time
- The measured distance appears in the Controls panel and bottom-right display

### 6. Rescaling the Model

1. The **"Measured Distance"** field shows the current measurement
2. Enter the actual real-world distance (in meters) in **"New Distance"**
3. Click **"Apply Rescale"**
4. The entire model scales to match the specified dimensions

### 7. Exporting the Model

1. Click **"Export PLY"**
2. The file downloads as `rescaled_model.ply`
3. The exported file includes all transformations (rescale and origin changes)

### 8. Reset

- Click **"Reset Points"** to clear measurement markers and start over
- Origin transformations and rescaling remain applied

---

## Controls

| Action | Function |
|--------|----------|
| Left-click | Place measurement point |
| Drag marker | Adjust measurement point position |
| Left-drag (empty space) | Rotate camera (infinite rotation) |
| Right-drag / Two-finger drag | Pan camera |
| Scroll / Pinch | Zoom |
| Right double-click | Set new coordinate origin |

**Camera Controls:**
- Infinite rotation in all directions (no angle limits)
- Zoom limits prevent performance issues (min: 0.5, max: 50)

---

## UI Layout

- **Top-left**: Instructions
- **Top-right**: Controls panel (collapsible)
  - Load PLY File
  - Toggle Axes
  - Measured Distance (read-only)
  - New Distance
  - Apply Rescale
  - Reset Points
  - Export PLY
- **Bottom-right**: Distance display (appears during measurement)

---

## Notes

- After rescaling, the model scales relative to the current origin
- After setting a new origin, all measurements are cleared
- The camera automatically adjusts to maintain view during origin changes
- Exported PLY files contain the final transformed coordinates
- All file formats (.ply, .spz, .splat) are supported for both loading and drag & drop
