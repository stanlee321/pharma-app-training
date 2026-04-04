# P0: Compartmental View — 3D Upgrade with SceneKit

## Problem

The current compartmental view uses 2D Canvas with flat rounded rectangles. The reference app (TivaTrainerX) uses **3D-rendered glass cylinders** with:
- Semi-transparent material with specular highlights
- Colored fluid that fills from the bottom with a meniscus
- Depth perspective (V2 behind V1, V3 beside V1)
- Lighting that gives real volume perception

Our current version looks like a developer prototype, not a medical tool. This screen is high-value for clinical education and app marketability.

## Current State (from recording)

What works well already:
- Layout structure (animation top, mini chart bottom) is correct
- Particles flowing along pipes are visible and directional
- Data/Sizes/Labels toggle buttons work
- Fluid fill levels respond to timeline scrubbing
- Volume labels (ml) appear in Sizes mode

What needs upgrading:
- Cylinders are flat 2D rounded rectangles with simple gradient
- No glass/transparency effect
- No depth or perspective
- Syringe is a tiny basic rectangle
- Pipe connections are thin lines (should be tubes)
- Compartments are bunched in the center with wasted space
- No clearance animation (just a line with arrow)

## Solution: SceneKit Implementation

### Technology Choice

**SceneKit** via `UIViewRepresentable` wrapping `SCNView`:
- Native Apple 3D framework, excellent iOS performance
- Built-in glass/transparent materials
- Cylinder (`SCNCylinder`) and tube geometries
- Particle systems (`SCNParticleSystem`) for drug molecules
- Camera control for optional rotation
- Integrates well with SwiftUI

### Scene Layout

```
Camera (fixed, slightly above, angled down ~20°)
│
├── Ambient Light (soft white)
├── Directional Light (top-right, creates depth shadows)
│
├── Syringe Node (left)
│   ├── Barrel (SCNBox, glass material)
│   ├── Plunger (SCNBox, animated position)
│   └── Needle (SCNCylinder, thin)
│
├── V1 Node (center)
│   ├── Glass Cylinder (SCNCylinder, transparent)
│   ├── Fluid Cylinder (SCNCylinder, colored, height animated)
│   └── Label Node (SCNText, "V1")
│
├── V2 Node (upper-right, slightly behind)
│   ├── Glass Cylinder
│   ├── Fluid Cylinder
│   └── Label Node
│
├── V3 Node (lower-right)
│   ├── Glass Cylinder (larger diameter — proportional to volume)
│   ├── Fluid Cylinder
│   └── Label Node
│
├── Effect Node (left of V1)
│   ├── Sphere or small cylinder (SCNSphere)
│   ├── Fill material (animated opacity)
│   └── Label "Effect"
│
├── Pipe: V1 ↔ V2 (SCNTube or SCNCylinder, thin)
├── Pipe: V1 ↔ V3
├── Pipe: V1 → Effect
├── Pipe: V1 → Clearance (downward)
│
└── Particle Systems
    ├── Syringe → V1 (red particles when infusing)
    ├── V1 → V2 (cyan particles)
    ├── V1 → V3 (teal particles)
    ├── V1 → Effect (green particles)
    └── V1 → CL (gray particles, falling)
```

### Materials

**Glass Cylinder:**
```swift
let glass = SCNMaterial()
glass.diffuse.contents = UIColor(white: 0.9, alpha: 0.15)
glass.specular.contents = UIColor.white
glass.shininess = 0.8
glass.transparency = 0.85
glass.isDoubleSided = true
glass.lightingModel = .physicallyBased
glass.metalness.contents = 0.0
glass.roughness.contents = 0.1
```

**Fluid Material:**
```swift
let fluid = SCNMaterial()
fluid.diffuse.contents = UIColor.systemRed.withAlphaComponent(0.6)
fluid.specular.contents = UIColor.white
fluid.shininess = 0.5
fluid.lightingModel = .physicallyBased
```

### Fluid Animation

The fluid inside each cylinder is a **second, shorter cylinder** placed inside the glass cylinder. Its height is animated:

```swift
func updateFluidLevel(cylinder: SCNNode, fill: Double, maxHeight: Double) {
    let fluidHeight = maxHeight * fill
    let fluidGeometry = SCNCylinder(radius: cylinderRadius - 0.02, height: fluidHeight)
    fluidNode.geometry = fluidGeometry
    // Position: bottom of glass cylinder + half fluid height
    fluidNode.position.y = -maxHeight/2 + fluidHeight/2
}
```

Animate with `SCNTransaction`:
```swift
SCNTransaction.begin()
SCNTransaction.animationDuration = 0.3
updateFluidLevel(...)
SCNTransaction.commit()
```

### Particle System

SceneKit has built-in `SCNParticleSystem`:
```swift
let particles = SCNParticleSystem()
particles.birthRate = 20
particles.particleLifeSpan = 2.0
particles.particleSize = 0.03
particles.particleColor = .cyan
particles.emitterShape = SCNSphere(radius: 0.01)
particles.speedFactor = rateConstant * 0.5
// Attach to pipe path
```

### Sizes Mode

When "Sizes" is toggled:
```swift
SCNTransaction.begin()
SCNTransaction.animationDuration = 0.5
v1Node.scale = SCNVector3(sizeScaleV1, sizeScaleV1, sizeScaleV1)
v2Node.scale = SCNVector3(sizeScaleV2, sizeScaleV2, sizeScaleV2)
v3Node.scale = SCNVector3(sizeScaleV3, sizeScaleV3, sizeScaleV3)
SCNTransaction.commit()
```

### Camera

Fixed camera with optional user rotation:
```swift
scnView.allowsCameraControl = false  // Start fixed
// "Rotate" button could enable: scnView.allowsCameraControl = true
```

The reference video shows the view from slightly different angles, suggesting the user can rotate.

## Implementation Plan

1. Create `CompartmentSceneView` (UIViewRepresentable wrapping SCNView)
2. Build scene hierarchy (cylinders, pipes, lights, camera)
3. Create materials (glass, fluid colors per drug)
4. Wire fluid levels to ViewModel (same data, new rendering)
5. Add particle systems along pipes
6. Implement Sizes mode (animated scale)
7. Replace CompartmentCanvas (2D) with CompartmentSceneView (3D) in CompartmentalView
8. Keep 2D Canvas as fallback for older devices / performance issues

## Estimated Effort

This is the single biggest UI improvement. Expect 2-3 focused sessions to get it looking close to the reference.
