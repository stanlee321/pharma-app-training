# Screen-by-Screen Implementation Guide

## Screen 1: Launch Modal

### Implementation
- **SwiftUI:** `ZStack` with blurred background + centered modal `VStack`
- **Storage:** `@AppStorage("hasSeenAnnouncement_v{id}")` for dismissal tracking
- **Data source:** Bundled JSON or remote endpoint for announcement content
- **Navigation:** On "Continue" → dismiss modal, push to Drug Selection

### Key Components
```
LaunchModalView
├── Background (Color.black.opacity(0.5) over blurred content)
└── Modal Card (VStack, rounded corners, padding)
    ├── Title (Text, bold, large)
    ├── Body (ScrollView > Text, multiline)
    ├── Button: "More info" → openURL()
    ├── Button: "Claim your discount" → openURL()
    ├── Button: "Continue" (primary) → dismiss + save state
    └── Footer (Text, small, gray)
```

### No Rust dependency — purely UI.

---

## Screen 2: Drug & Model Selection

### Implementation
- **Picker:** SwiftUI `Picker` with `.pickerStyle(.wheel)` or custom `UIPickerView` via UIViewRepresentable for better scroll performance
- **Data:** Load `drug_models.json` into `[DrugModel]` array at app startup
- **Metadata:** Updates via `onChange(of: selectedIndex)` — simple array lookup, no computation

### Key Components
```
DrugSelectionView
├── NavigationStack header ("Select Drug 1" + "SELECT 1" button)
├── Metadata ScrollView (read-only)
│   ├── Description
│   ├── Publication (with tappable links via AttributedString)
│   ├── Comments
│   └── Implementation details
├── Wheel Picker (drug + model combinations)
└── Bottom Toolbar ("Edit Drug List", "Saved Simulations")
```

### Drug Model JSON Schema
```json
{
  "id": "propofol_marsh",
  "drug": "Propofol",
  "model": "Marsh",
  "description": "Implemented in Diprifusor https://eurosiva.eu",
  "publication": {
    "title": "Br. J Anaesthesia 1991;67:41-48",
    "url": "https://eurosiva.eu"
  },
  "comments": "None",
  "concentration_unit": "mcg/ml",
  "target_effects": ["Plasma", "Effect-site"],
  "manual_dosing_rules": null,
  "preparation_recipe": "Propofol 1% (10 mg/ml)",
  "default_dilution_mg_ml": 10.0,
  "validation_rules": {
    "weight": { "min": 30, "max": 150 },
    "height": { "min": 100, "max": 220 },
    "age": { "min": 1, "max": 99 },
    "gender": ["male", "female"],
    "requires_height": false,
    "requires_gender": false
  },
  "rust_model_id": "marsh"
}
```

```json
{
  "id": "dexmedetomidine_hannivoort",
  "drug": "Dexmedetomidine",
  "model": "Hannivoort",
  "description": "British Journal of Anaesthesia, 115(2): 200-10 (2017)",
  "publication": {
    "title": "Hannivoort et al. 2015",
    "url": null
  },
  "comments": "FULL PHARMACODYNAMICS IMPLEMENTED\nsedation 0.2 to 2.0 ng/ml blood concentration\n(supra) additive interaction with other sedatives and opioids exist\nTarget effect: Heart rate(bradycardia)",
  "concentration_unit": "ng/ml",
  "target_effects": ["Effect-site", "Plasma"],
  "manual_dosing_rules": "loading dose 1 mcg/kg over 10 minutes\nelderly patient: 0.5 mcg/kg over 10 minutes",
  "preparation_recipe": "2 ml Dexmedetomidine + 45 ml NaCl 0.9%",
  "default_dilution_mg_ml": 0.004,
  "validation_rules": {
    "weight": { "min": 45, "max": 120 },
    "height": { "min": 100, "max": 220 },
    "age": { "min": 18, "max": 80 },
    "gender": ["male", "female"],
    "requires_height": false,
    "requires_gender": false
  },
  "rust_model_id": "hannivoort"
}
```

### Known drugs from reference video (picker list)
The picker shows more drug/model combos than the initial 4 core models:
- Propofol [Marsh]
- Propofol [Schnider]
- Dexmedetomidine [Hannivoort]
- Dexmedetomidine [Eyol...] (possibly Eyeldi)
- Levobupivacaine [Hart...]
- Lidocaine [Russel...]
- (likely more not visible in video)

Start with the 4 core models; the JSON database is extensible.

### No Rust dependency — purely UI + local data.

---

## Screen 3: Patient Data Input

### Implementation
- **Steppers:** Custom `AcceleratingRepeatButton` that fires faster on long-press
- **Validation:** Real-time min/max clamping from `validationRules` in selected model
- **Gender:** `Toggle` or segmented `Picker` (Male/Female)
- **"Done" action:** Build `PatientProfile`, call Rust engine for initial calculation, navigate to Simulation

### Key Components (from video frame analysis)
```
PatientInputView
├── Header: "< Select Drug" (back) | "1" (center) | "Done" (right)
├── Drug Name (bold, centered): "Dexmedetomidine"
├── Preparation Recipe (gray text): "2 ml Dexmedetomidine+45 ml Na..."
├── Dilution Row: "Dilution" | [0.0...] | "mg/ml" | [-] [+]
├── Separator line
├── Section Header: "Patient data" (bold, centered)
├── Weight Row:  "Weight"  | "80 Kg"  | [-] [+]
├── Length Row:  "Length"   | "170 cm" | [-] [+]
├── Age Row:     "A..."    | "40 yr"  | [-] [+]
├── Gender Row:  "Gender"  |          | "Male" (blue tappable text, right-aligned)
└── (Validation feedback if out of range)
```

**Light theme** — white/light gray background, consistent with Screens 1-2.

### AcceleratingRepeatButton Behavior
```
Initial tap:     +1 / -1
Hold 0-500ms:    +1 per 200ms
Hold 500ms-1s:   +1 per 100ms
Hold 1s+:        +5 per 100ms
```

### First Rust call happens on "Done":
```swift
// ViewModel
func onDone() {
    let input = SimulationInput(
        modelId: selectedModel.rustModelId,
        patient: patientProfile,
        targets: [],           // empty initially
        timeRangeSeconds: 3600 // 60 min default
    )
    let result = engineBridge.computeInitialState(input)
    simulationState.initialize(with: result)
    navigate(.simulation)
}
```

---

## Screen 4: Main Simulation Graph

### Implementation
- **Chart:** Custom `Canvas` view (SwiftUI) — no 3rd party library
- **Dual Y-axes:** Left = concentration, Right = infusion rate
- **Draggable target:** `DragGesture` on circle overlay, clamped to Y-axis range
- **Real-time update:** On drag change → call Rust `pk_engine_compute_tci_target()` → update readouts
- **Curve rendering:** Pre-computed `[CGPoint]` arrays drawn as `Path` in Canvas
- **Time cursor:** Vertical line with `DragGesture` for scrubbing

### Key Components (updated from video analysis)
```
SimulationView  ← DARK THEME (black background, designed for dim OR environments)
├── Top Toolbar
│   ├── Left: "Manual" mode label (suggests Manual vs Auto TCI modes)
│   ├── Center: Drug name ("Dexmedetomidine")
│   └── Right: Settings/Play/Speed icons
├── Status Dashboard
│   ├── Model name: "Hannivoort"
│   └── Concentration: "0.004 mg/ml"
├── Dynamic Readouts (visible during target drag)
│   ├── Left column:  "Bolus  0.0 ML" / "0.000 mg/kg"
│   └── Right column: "93.2 ML/hr" / "4.632 mcg/kg/hr"
├── Chart Area (Canvas) ← dark background, colored curves
│   ├── Y-Axis Left (concentration scale, white text)
│   ├── Y-Axis Right (infusion rate scale)
│   ├── X-Axis (time as minute markers: 5, 10, 15, 20)
│   ├── Grid lines (subtle gray)
│   ├── Curve paths (multiple colors: Cp, Ce, infusion rate, etc.)
│   ├── Time Cursor (bright blue vertical line, draggable)
│   ├── Target Node (bright blue circle on cursor, draggable vertically)
│   └── Data Tooltip: floating box showing per-curve values
│       └── Format: "0.43" / "0.1(Ke0)" / "0.3(Cp)" — value with curve label
├── Time display: "00:14:32" format (HH:MM:SS at cursor)
├── Bottom Toolbar
│   ├── Default: "+ Graph" | "Time(min)" | info icon
│   └── During drag: "Cancel" | "Done" | ↑ ↓ (nudge buttons)
```

### Interaction State Machine
```
IDLE ──(tap graph)──► TARGET_ACTIVE ──(drag Y)──► DRAGGING
  ▲                                                   │
  │                    ┌──(Cancel)────────────────────┘
  │                    │
  └──(Done)────────────┘
       │
       └──► SIMULATING ──(complete)──► IDLE (with new curves)
```

### Rust calls during drag (must be < 16ms):
```swift
// Called on every drag gesture change
func onTargetDrag(concentration: Double) {
    let tciResult = engineBridge.computeTCIForTarget(
        modelId: model.rustModelId,
        patient: patient,
        currentState: simulationState.currentCompartmentState,
        targetConcentration: concentration,
        targetType: .effectSite // or .plasma
    )
    // Update UI readouts (no full curve recompute)
    readouts.bolus = tciResult.bolusDose
    readouts.infusionRate = tciResult.infusionRate
}
```

### Rust call on "Done" (can take up to 50ms):
```swift
func onTargetConfirmed() {
    let curves = engineBridge.simulateWithTarget(
        modelId: model.rustModelId,
        patient: patient,
        targets: simulationState.allTargets, // array of (time, concentration)
        timeRange: simulationState.timeRange,
        resolution: 1.0 // one point per second
    )
    simulationState.updateCurves(curves)
}
```

---

## Screen 5: Compartmental Animation

### Implementation
- **Top half:** SwiftUI `Canvas` with custom drawing for cylinders, pipes, particles
- **Bottom half:** Reuse `ChartCanvas` in mini mode with scrubbing
- **Sync:** Both halves driven by single `currentTime` binding
- **Particles:** Pre-compute particle positions per frame, render in Canvas

### Key Components (updated from video — 3D rendering, not 2D)
```
CompartmentalView  ← DARK THEME
├── Top Toolbar: "Data" | [Sizes] | "Labels" | "X" (close)
├── 3D Animation Canvas (top half) ← SceneKit or Metal, NOT flat Canvas
│   ├── Syringe/IV graphic (left side)
│   │   └── "IV assist" button (toggles IV assist visualization)
│   ├── V1 Cylinder (central) — 3D glass-like, red/teal fluid fill
│   ├── V2 Cylinder (rapid peripheral) — 3D, proportionally sized
│   ├── V3 Cylinder (slow peripheral) — 3D, largest
│   ├── Effect Site (small compartment)
│   ├── Clearance (exit graphic)
│   ├── Connecting Pipes (3D tubes between compartments)
│   ├── Particle System (animated dots flowing in pipes)
│   └── Volume Labels (visible in "Sizes" mode, e.g., "34 ml")
├── Status Bar
│   ├── Drug: "Dexmedetomidine" with icon
│   ├── Concentration: "4.1" with icon
│   └── Model: "Hannivoort 0.004 mg/ml"
└── Mini Chart (bottom half)
    ├── Same curve rendering as main graph (dark bg, colored curves)
    ├── Scrub cursor (vertical line, draggable)
    ├── Time: "00:24:00"
    └── Bottom: "+ Graph" | "Time(min)" | info
```

### 3D Rendering Approach

The reference video shows **3D-perspective cylinders** with:
- Semi-transparent glass material
- Colored fluid fill that rises/falls
- Perspective depth and lighting
- Apparent rotation capability (different viewing angles visible)
- Volume labels rendered on cylinders in "Sizes" mode

**Recommended tech:** `SceneKit` via SwiftUI `SceneView`:
- Native Apple 3D framework, well-supported on iOS
- Can create cylinder geometries with custom materials
- Supports animation, transparency, and camera rotation
- Lighter weight than RealityKit for this use case

**Alternative (simpler v1):** Fake 3D with SwiftUI Canvas using gradients + perspective transforms. Faster to implement but less visually impressive.

### Cylinder Fluid Level Calculation
```swift
// For each compartment at time t:
let amount = curves.compartmentAmount(cmt: .v1, at: currentTime)
let volume = engineResult.compartmentVolume(.v1) // from patient params
let fillFraction = min(amount / maxConcentration, 1.0)
// Draw cylinder filled to fillFraction
```

### "Sizes" Mode
When "Sizes" is tapped, cylinders scale proportionally to V1, V2, V3 volumes:
```swift
let maxVolume = max(v1, v2, v3)
let v1Scale = v1 / maxVolume  // cylinder width/height proportional
let v2Scale = v2 / maxVolume
let v3Scale = v3 / maxVolume
```

### Particle System
- Pre-compute for each second: which pipes have flow, flow rate magnitude
- Particles move along pipe paths at speed proportional to rate constants (k12, k21, k13, k31, ke0, k10)
- On scrub: instantly set particle positions to match time point (no animation, just placement)
- On play: animate particles smoothly along paths

### Data from Rust:
The compartmental view uses the **same simulation output** as the main graph — no additional Rust calls needed. It just reads different columns:
- `amount_v1[t]`, `amount_v2[t]`, `amount_v3[t]`, `amount_effect[t]`
- `infusion_rate[t]` (for syringe animation)
- Rate constants `k12, k21, k13, k31, ke0, k10` (for particle speed)
