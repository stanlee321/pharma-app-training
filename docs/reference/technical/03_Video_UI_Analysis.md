# UI Analysis from Reference Video

Source: `VIDEO-2026-03-31-19-19-45.mp4` (2:22 duration)
Timestamps: see `07_Video_Timestamps_FFmpeg.md`

This document captures UI details visible in the reference video that go beyond the functional requirement docs.

---

## Screen 2: Drug & Model Selection (00:04–00:18)

### Drug Database Is Larger Than Initially Documented

The picker wheel shows more drugs than the 4 core models (Marsh, Schnider, Minto, Hannivoort):

Visible in picker:
- Propofol [Marsh]
- Propofol [Schnider] (presumed, not fully visible)
- Dexmedetomidine [Hannivoort]
- Dexmedetomidine [Eyol...] (likely Eyeldi or similar)
- Levobupivacaine [Hart...]
- Lidocaine [Russel...]

**Implication for Rust engine:** The `ModelId` enum and model registry need to be extensible. Start with the 4 core models but design the `TivaModel` trait so adding new drugs is just a new struct. The drug database JSON should be the source of truth for the full list.

### Metadata Display — Exact Fields Visible

For **Propofol [Marsh]**:
```
Description: Implemented in Diprifusor https://eurosiva.eu
Publication: Br. J Anaesthesia 1991;67:41-48
Comment: None
```

For **Dexmedetomidine [Hannivoort]**:
```
Description: (publication info)
2015, British Journal of Anaesthesia, 115(2): 200-10 (2017)

Comment (ITCI):
FULL PHARMACODYNAMICS IMPLEMENTED
sedation 0.2 to 2.0 ng/ml blood concentration
(supra) additive interaction with other sedatives and opioids exist
Target effect: Heart rate(bradycardia)
Manual dosing:
loading dose 1 mcg/kg over 10 minutes
elderly patient: 0.5 mcg/kg over 10 minutes
```

**Implication:** The metadata text can be long and detailed. The metadata area needs to be scrollable. Links (eurosiva.eu) are tappable.

---

## Screen 3: Patient Data Input (00:18–00:21)

### Dilution Field Shows a Preparation Recipe

The screen shows not just a numeric dilution value but a **preparation formula**:
```
Dexmedetomidine
2 ml Dexmedetomidine+45 ml Na...  (likely NaCl 0.9%)
Dilution: 0.0... mg/ml  [-] [+]
```

**Implication:** Each drug in the database needs a `preparation_recipe` string (e.g., "2 ml Dexmedetomidine + 45 ml NaCl 0.9%") displayed above the dilution stepper. The dilution value might auto-calculate from the recipe or be manually set.

### Visible Patient Values
```
Weight:  80 Kg
Length:  170 cm
Age:    40 yr
Gender: Male (displayed as blue text, right-aligned — likely a tappable toggle)
```

### Layout
- Header: "< Select Drug 1" (back) | "1" (center) | "Done" (right)
- Drug name bold at top
- Preparation recipe below drug name (gray text)
- Dilution row with value + unit + stepper
- Separator
- "Patient data" section header
- Each row: Label | Value + Unit | [-] [+] buttons
- Gender row: Label | "Male"/"Female" as tappable text (no stepper)

---

## Screen 4: Main Simulation Graph (00:21–01:30)

### Theme
**Dark background** (black/very dark gray) for the entire simulation view. This is a deliberate contrast from the light-themed input screens — better for operating room environments with dim lighting.

### Target Node Interaction (00:21–00:54)

Top readout bar visible during drag:
```
Bolus    0.0 ML       |   93.2  ML/hr
         0.000 mg/kg  |   4.632 mcg/kg/hr
```

Status bar:
```
Hannivoort
0.004 mg/ml
```

The target node is a **bright blue circle** on a **blue vertical cursor line**. The Y-axis shows concentration scale (0 to ~2.0+ in this case).

Bottom toolbar during drag:
```
Cancel  |  Done  |  ↑  ↓
```
The ↑↓ are nudge buttons for fine-tuning the target by small increments.

### Graph Simulation Running (00:54–01:30)

Header changes to show:
```
Manual    Dexmedetomidine    [icons]
```

**"Manual" mode label** — this suggests there are at least two modes:
- **Manual:** User manually sets targets by dragging
- Possibly **TCI Auto:** Where the pump automatically adjusts (future feature?)

**Multiple colored curves visible:**
- Different colors for Plasma concentration (Cp), Effect-site concentration (Ce), and possibly infusion rate
- Curve legend/tooltip shows values like:
  ```
  0.43
  0.1(Ke0)
  0.3(Cp)
  ```
  These appear to be: Ce value, Ke0-related value, and Cp value

**Data tooltip** appears as a floating box near the vertical time cursor showing exact numerical values for each curve at the scrubbed time point.

**Time display:** `00:14:32` format (HH:MM:SS) at the cursor position

**X-axis:** Shows time in minute markers (5, 10, 15, 20)

---

## Screen 5: Compartmental Animation (01:30–02:20)

### This Is 3D, Not 2D

The compartmental visualization uses **3D-rendered cylinders** with:
- Semi-transparent glass-like material
- Perspective/depth
- Colored fluid fill (red/teal for drug concentration)
- Volume labels ("34 ml" visible on cylinders in Sizes mode)
- The view appears to be **rotatable** — frames show different viewing angles

### Layout

```
┌─────────────────────────────────────┐
│  Data  │ [Sizes] │ Labels │    X    │  ← top toolbar
├─────────────────────────────────────┤
│                                     │
│  [Syringe]  ──►  [V1]  ──►  [V2]  │  ← 3D cylinders
│  IV assist       (red)             │
│                    │                │
│                    ▼                │
│                  [V3]     [Effect]  │
│                         (Clearance) │
│                                     │
├─────────────────────────────────────┤
│  Dexmedetomidine  [icon] 4.1 [icon]│  ← status bar
│  Hannivoort                         │
│  0.004 mg/ml                        │
├─────────────────────────────────────┤
│  [Mini graph with curves]           │  ← bottom chart
│  ──────────┼──────────────          │
│         00:24:00                    │  ← scrub cursor
│  + Graph  │ Time(min)  │    i      │
└─────────────────────────────────────┘
```

### "IV assist" Button
Visible on the left side near the syringe graphic. Likely toggles an automated IV bolus assist visualization. Not documented in original specs.

### "Sizes" Mode
When the "Sizes" button is highlighted/active:
- Cylinders resize proportionally to their computed volumes (V1, V2, V3)
- Actual volume values are displayed as labels ON the cylinders (e.g., "34 ml")
- V1 (central) appears much smaller than V2/V3, which is pharmacologically correct

### "Data" Button
Likely toggles numerical data overlay on the animation (rate constants, amounts).

### "Labels" Button
Likely toggles compartment name labels (V1, V2, V3, Effect, Clearance).

### 3D Rendering Technology Choice
The 3D quality visible in the video suggests this was likely built with:
- SceneKit (Apple's 3D framework) — most likely for iOS
- Or custom Metal shaders for the cylinder rendering

**For our rebuild:** SceneKit with SwiftUI via `SceneView` is the pragmatic choice. Alternative: RealityKit, but that's overkill. Another option: custom SwiftUI Canvas with faked 3D (gradient + perspective transform) for a lighter implementation.

### Fluid Animation Details
- V1 (central compartment) has **red-colored fluid** that fills from bottom
- The fluid level visually corresponds to the drug amount in that compartment
- During infusion: fluid level rises
- During redistribution/elimination: fluid level falls
- The syringe graphic shows fluid being "pushed" into V1

### Connecting Pipes
Visible between compartments showing:
- V1 ↔ V2 (bidirectional)
- V1 ↔ V3 (bidirectional)
- V1 → Effect (ke0 direction)
- V1 → Clearance (elimination, k10)

### Particle Animation
Small dots/particles animate along the pipes. Speed corresponds to rate constants. Direction shows net flow at current time point.

---

## General UI Observations

### Color Scheme
- **Input screens (Views 1-3):** Light theme (white/light gray background)
- **Simulation screens (Views 4-5):** Dark theme (black background) — designed for dim OR environments

### Typography
- Drug names: Bold, medium size
- Model names: Regular weight, smaller
- Concentration values: Monospace or fixed-width for alignment
- Units always shown inline (mg/ml, Kg, cm, yr)

### Navigation Pattern
- Linear flow: Modal → Drug → Patient → Simulation → Compartmental
- Back navigation available at each step
- Compartmental view accessed from simulation view (separate entry point)
- "X" close button on compartmental returns to simulation view
