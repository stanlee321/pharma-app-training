import SwiftUI
import SceneKit

/// SceneKit 3D compartmental visualization wrapped for SwiftUI.
struct CompartmentSceneView: UIViewRepresentable {
    let fillV1: Double
    let fillV2: Double
    let fillV3: Double
    let fillEffect: Double
    let scaleV1: Double
    let scaleV2: Double
    let scaleV3: Double
    let infusionRate: Double
    let showLabels: Bool
    let showData: Bool
    let showSizes: Bool
    let volumeV1: Double
    let volumeV2: Double
    let volumeV3: Double
    let time: Double

    func makeUIView(context: Context) -> SCNView {
        let scnView = SCNView()
        scnView.backgroundColor = .black
        scnView.antialiasingMode = .multisampling4X
        scnView.allowsCameraControl = true
        scnView.defaultCameraController.interactionMode = .orbitTurntable
        scnView.autoenablesDefaultLighting = false

        let scene = SCNScene()
        scnView.scene = scene

        context.coordinator.buildScene(scene: scene)

        return scnView
    }

    func updateUIView(_ scnView: SCNView, context: Context) {
        guard let scene = scnView.scene else { return }
        context.coordinator.update(
            scene: scene,
            fillV1: fillV1, fillV2: fillV2, fillV3: fillV3, fillEffect: fillEffect,
            scaleV1: scaleV1, scaleV2: scaleV2, scaleV3: scaleV3,
            infusionRate: infusionRate,
            showLabels: showLabels, showData: showData, showSizes: showSizes,
            volumeV1: volumeV1, volumeV2: volumeV2, volumeV3: volumeV3,
            time: time
        )
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    // MARK: - Coordinator

    class Coordinator {
        // Node references for updates
        var fluidV1: SCNNode?
        var fluidV2: SCNNode?
        var fluidV3: SCNNode?
        var glassV1: SCNNode?
        var glassV2: SCNNode?
        var glassV3: SCNNode?
        var effectNode: SCNNode?
        var effectGlow: SCNNode?
        var syringeFluid: SCNNode?
        var syringePlunger: SCNNode?
        var labelNodes: [SCNNode] = []
        var dataNodes: [SCNNode] = []
        var sizeNodes: [SCNNode] = []
        var particleSystems: [SCNNode] = []

        // Cylinder dimensions
        let cylRadius: CGFloat = 0.3
        let cylHeight: CGFloat = 1.0

        // Positions
        let posV1 = SCNVector3(0, 0, 0)
        let posV2 = SCNVector3(1.2, 0.8, -0.3)
        let posV3 = SCNVector3(1.2, -0.8, 0.3)
        let posEffect = SCNVector3(-1.5, 0, 0)
        let posSyringe = SCNVector3(-2.8, 0, 0)

        func buildScene(scene: SCNScene) {
            // Camera
            let camera = SCNCamera()
            camera.fieldOfView = 40
            camera.zNear = 0.1
            camera.zFar = 50
            let cameraNode = SCNNode()
            cameraNode.camera = camera
            cameraNode.position = SCNVector3(0, 1.5, 6)
            cameraNode.look(at: SCNVector3(0, -0.2, 0))
            scene.rootNode.addChildNode(cameraNode)

            // Lights
            addLighting(to: scene.rootNode)

            // Floor grid (subtle)
            addFloorGrid(to: scene.rootNode)

            // Compartments
            buildCompartment(parent: scene.rootNode, name: "V1", pos: posV1, color: .systemRed)
            buildCompartment(parent: scene.rootNode, name: "V2", pos: posV2, color: .cyan)
            buildCompartment(parent: scene.rootNode, name: "V3", pos: posV3, color: .systemTeal)

            // Effect site
            buildEffectSite(parent: scene.rootNode)

            // Syringe
            buildSyringe(parent: scene.rootNode)

            // Pipes
            buildPipe(parent: scene.rootNode, from: posV1, to: posV2, name: "pipe_v1_v2", color: .cyan)
            buildPipe(parent: scene.rootNode, from: posV1, to: posV3, name: "pipe_v1_v3", color: .systemTeal)
            buildPipe(parent: scene.rootNode, from: posV1, to: posEffect, name: "pipe_v1_eff", color: .green)
            buildPipe(parent: scene.rootNode, from: posSyringe, to: posV1, name: "pipe_syr_v1", color: .systemRed)

            // Clearance pipe (downward)
            let clPos = SCNVector3(posV1.x, posV1.y - 1.8, posV1.z)
            buildPipe(parent: scene.rootNode, from: posV1, to: clPos, name: "pipe_cl", color: .gray)
            addLabel(parent: scene.rootNode, text: "CL", position: SCNVector3(clPos.x + 0.15, clPos.y, clPos.z), name: "label_CL")
        }

        // MARK: - Lighting

        func addLighting(to parent: SCNNode) {
            // Ambient
            let ambient = SCNLight()
            ambient.type = .ambient
            ambient.color = UIColor(white: 0.25, alpha: 1)
            let ambientNode = SCNNode()
            ambientNode.light = ambient
            parent.addChildNode(ambientNode)

            // Key light (top-right)
            let key = SCNLight()
            key.type = .directional
            key.color = UIColor(white: 0.8, alpha: 1)
            key.castsShadow = true
            key.shadowRadius = 3
            key.shadowSampleCount = 8
            let keyNode = SCNNode()
            keyNode.light = key
            keyNode.position = SCNVector3(3, 5, 4)
            keyNode.look(at: SCNVector3(0, 0, 0))
            parent.addChildNode(keyNode)

            // Fill light (left, softer)
            let fill = SCNLight()
            fill.type = .directional
            fill.color = UIColor(white: 0.3, alpha: 1)
            let fillNode = SCNNode()
            fillNode.light = fill
            fillNode.position = SCNVector3(-3, 2, 3)
            fillNode.look(at: SCNVector3(0, 0, 0))
            parent.addChildNode(fillNode)
        }

        // MARK: - Floor Grid

        func addFloorGrid(to parent: SCNNode) {
            let floor = SCNFloor()
            floor.reflectivity = 0.05
            let mat = SCNMaterial()
            mat.diffuse.contents = UIColor(white: 0.03, alpha: 1)
            mat.lightingModel = .constant
            floor.materials = [mat]
            let floorNode = SCNNode(geometry: floor)
            floorNode.position = SCNVector3(0, -1.5, 0)
            parent.addChildNode(floorNode)
        }

        // MARK: - Compartment

        func buildCompartment(parent: SCNNode, name: String, pos: SCNVector3, color: UIColor) {
            // Glass cylinder
            let glass = SCNCylinder(radius: cylRadius, height: cylHeight)
            glass.radialSegmentCount = 32
            let glassMat = SCNMaterial()
            glassMat.diffuse.contents = UIColor(white: 1.0, alpha: 0.08)
            glassMat.specular.contents = UIColor.white
            glassMat.shininess = 0.9
            glassMat.transparency = 0.15
            glassMat.isDoubleSided = true
            glassMat.lightingModel = .physicallyBased
            glassMat.metalness.contents = 0.0
            glassMat.roughness.contents = 0.08
            glass.materials = [glassMat]

            let glassNode = SCNNode(geometry: glass)
            glassNode.position = pos
            glassNode.name = "glass_\(name)"
            parent.addChildNode(glassNode)

            // Glass rim (top edge highlight)
            let rim = SCNTorus(ringRadius: cylRadius, pipeRadius: 0.012)
            let rimMat = SCNMaterial()
            rimMat.diffuse.contents = UIColor(white: 0.6, alpha: 0.4)
            rimMat.lightingModel = .constant
            rim.materials = [rimMat]
            let rimNode = SCNNode(geometry: rim)
            rimNode.position = SCNVector3(pos.x, pos.y + Float(cylHeight / 2), pos.z)
            parent.addChildNode(rimNode)

            // Fluid cylinder (inner, starts at 0 height)
            let fluid = SCNCylinder(radius: cylRadius - 0.02, height: 0.001)
            fluid.radialSegmentCount = 32
            let fluidMat = SCNMaterial()
            fluidMat.diffuse.contents = color.withAlphaComponent(0.6)
            fluidMat.specular.contents = UIColor.white
            fluidMat.shininess = 0.3
            fluidMat.lightingModel = .physicallyBased
            fluidMat.roughness.contents = 0.4
            fluid.materials = [fluidMat]

            let fluidNode = SCNNode(geometry: fluid)
            fluidNode.position = SCNVector3(pos.x, pos.y - Float(cylHeight / 2), pos.z)
            fluidNode.name = "fluid_\(name)"
            parent.addChildNode(fluidNode)

            // Store references
            switch name {
            case "V1": glassV1 = glassNode; fluidV1 = fluidNode
            case "V2": glassV2 = glassNode; fluidV2 = fluidNode
            case "V3": glassV3 = glassNode; fluidV3 = fluidNode
            default: break
            }

            // Label
            addLabel(parent: parent, text: name, position: SCNVector3(pos.x, pos.y + Float(cylHeight / 2) + 0.15, pos.z), name: "label_\(name)")
        }

        // MARK: - Effect Site

        func buildEffectSite(parent: SCNNode) {
            let sphere = SCNSphere(radius: 0.18)
            sphere.segmentCount = 24
            let mat = SCNMaterial()
            mat.diffuse.contents = UIColor.green.withAlphaComponent(0.15)
            mat.specular.contents = UIColor.white
            mat.transparency = 0.3
            mat.isDoubleSided = true
            mat.lightingModel = .physicallyBased
            mat.roughness.contents = 0.1
            sphere.materials = [mat]

            let node = SCNNode(geometry: sphere)
            node.position = posEffect
            node.name = "effect_glass"
            parent.addChildNode(node)
            effectNode = node

            // Inner glow sphere
            let glow = SCNSphere(radius: 0.12)
            let glowMat = SCNMaterial()
            glowMat.diffuse.contents = UIColor.green.withAlphaComponent(0.0)
            glowMat.emission.contents = UIColor.green.withAlphaComponent(0.0)
            glowMat.lightingModel = .constant
            glow.materials = [glowMat]
            let glowNode = SCNNode(geometry: glow)
            glowNode.position = posEffect
            glowNode.name = "effect_glow"
            parent.addChildNode(glowNode)
            effectGlow = glowNode

            addLabel(parent: parent, text: "Effect", position: SCNVector3(posEffect.x, posEffect.y + 0.3, posEffect.z), name: "label_Effect")
        }

        // MARK: - Syringe

        func buildSyringe(parent: SCNNode) {
            let pos = posSyringe

            // Barrel
            let barrel = SCNBox(width: 0.2, height: 0.6, length: 0.2, chamferRadius: 0.03)
            let barrelMat = SCNMaterial()
            barrelMat.diffuse.contents = UIColor(white: 0.15, alpha: 1)
            barrelMat.specular.contents = UIColor.white
            barrelMat.lightingModel = .physicallyBased
            barrelMat.roughness.contents = 0.3
            barrel.materials = [barrelMat]
            let barrelNode = SCNNode(geometry: barrel)
            barrelNode.position = pos
            barrelNode.name = "syringe_barrel"
            parent.addChildNode(barrelNode)

            // Fluid inside syringe
            let sFluid = SCNBox(width: 0.16, height: 0.01, length: 0.16, chamferRadius: 0.02)
            let sFluidMat = SCNMaterial()
            sFluidMat.diffuse.contents = UIColor.systemRed.withAlphaComponent(0.0)
            sFluidMat.emission.contents = UIColor.systemRed.withAlphaComponent(0.0)
            sFluidMat.lightingModel = .constant
            sFluid.materials = [sFluidMat]
            let sFluidNode = SCNNode(geometry: sFluid)
            sFluidNode.position = SCNVector3(pos.x, pos.y - 0.2, pos.z)
            sFluidNode.name = "syringe_fluid"
            parent.addChildNode(sFluidNode)
            syringeFluid = sFluidNode

            // Plunger rod
            let rod = SCNCylinder(radius: 0.015, height: 0.4)
            let rodMat = SCNMaterial()
            rodMat.diffuse.contents = UIColor(white: 0.4, alpha: 1)
            rodMat.lightingModel = .physicallyBased
            rod.materials = [rodMat]
            let rodNode = SCNNode(geometry: rod)
            rodNode.position = SCNVector3(pos.x, pos.y + 0.5, pos.z)
            rodNode.name = "syringe_plunger"
            parent.addChildNode(rodNode)
            syringePlunger = rodNode

            // Needle
            let needle = SCNCylinder(radius: 0.008, height: 0.3)
            let needleMat = SCNMaterial()
            needleMat.diffuse.contents = UIColor(white: 0.7, alpha: 1)
            needleMat.metalness.contents = 0.8
            needleMat.lightingModel = .physicallyBased
            needle.materials = [needleMat]
            let needleNode = SCNNode(geometry: needle)
            needleNode.position = SCNVector3(pos.x + 0.3, pos.y, pos.z)
            needleNode.eulerAngles = SCNVector3(0, 0, -Float.pi / 2)
            parent.addChildNode(needleNode)

            addLabel(parent: parent, text: "IV", position: SCNVector3(pos.x, pos.y + 0.9, pos.z), name: "label_IV")
        }

        // MARK: - Pipes

        func buildPipe(parent: SCNNode, from: SCNVector3, to: SCNVector3, name: String, color: UIColor) {
            let dx = to.x - from.x
            let dy = to.y - from.y
            let dz = to.z - from.z
            let length = sqrt(dx*dx + dy*dy + dz*dz)

            let pipe = SCNCylinder(radius: 0.018, height: CGFloat(length))
            let mat = SCNMaterial()
            mat.diffuse.contents = color.withAlphaComponent(0.25)
            mat.emission.contents = color.withAlphaComponent(0.08)
            mat.lightingModel = .constant
            pipe.materials = [mat]

            let node = SCNNode(geometry: pipe)
            node.position = SCNVector3(
                (from.x + to.x) / 2,
                (from.y + to.y) / 2,
                (from.z + to.z) / 2
            )
            node.name = name

            // Rotate to align
            let dir = SCNVector3(dx, dy, dz)
            node.look(at: to, up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 1, 0))

            parent.addChildNode(node)

            // Particles along pipe
            addPipeParticles(parent: parent, from: from, to: to, color: color, name: "\(name)_particles")
        }

        func addPipeParticles(parent: SCNNode, from: SCNVector3, to: SCNVector3, color: UIColor, name: String) {
            let particles = SCNParticleSystem()
            particles.birthRate = 6
            particles.particleLifeSpan = 2.5
            particles.particleSize = 0.035
            particles.particleColor = color
            particles.emitterShape = SCNSphere(radius: 0.02)
            particles.spreadingAngle = 5
            particles.particleVelocity = 0.3
            particles.particleVelocityVariation = 0.1
            particles.blendMode = .additive
            particles.isAffectedByGravity = false

            let emitterNode = SCNNode()
            emitterNode.position = from
            emitterNode.addParticleSystem(particles)
            emitterNode.name = name

            // Point particles toward destination
            let dx = to.x - from.x
            let dy = to.y - from.y
            let dz = to.z - from.z
            emitterNode.look(at: to, up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 0, -1))

            parent.addChildNode(emitterNode)
            particleSystems.append(emitterNode)
        }

        // MARK: - Labels

        func addLabel(parent: SCNNode, text: String, position: SCNVector3, name: String) {
            let textGeo = SCNText(string: text, extrusionDepth: 0)
            textGeo.font = UIFont.systemFont(ofSize: 0.12, weight: .bold)
            textGeo.flatness = 0.1
            let mat = SCNMaterial()
            mat.diffuse.contents = UIColor.white.withAlphaComponent(0.8)
            mat.lightingModel = .constant
            textGeo.materials = [mat]

            let textNode = SCNNode(geometry: textGeo)
            // Center the text
            let (min, max) = textGeo.boundingBox
            let cx = (max.x - min.x) / 2 + min.x
            let cy = (max.y - min.y) / 2 + min.y
            textNode.pivot = SCNMatrix4MakeTranslation(cx, cy, 0)
            textNode.position = position
            textNode.name = name

            // Billboard constraint (always face camera)
            let billboard = SCNBillboardConstraint()
            billboard.freeAxes = [.X, .Y]
            textNode.constraints = [billboard]

            parent.addChildNode(textNode)
            labelNodes.append(textNode)
        }

        // MARK: - Update

        func update(
            scene: SCNScene,
            fillV1: Double, fillV2: Double, fillV3: Double, fillEffect: Double,
            scaleV1: Double, scaleV2: Double, scaleV3: Double,
            infusionRate: Double,
            showLabels: Bool, showData: Bool, showSizes: Bool,
            volumeV1: Double, volumeV2: Double, volumeV3: Double,
            time: Double
        ) {
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.25

            // Update fluid levels
            updateFluid(fluidV1, fill: fillV1, basePos: posV1)
            updateFluid(fluidV2, fill: fillV2, basePos: posV2)
            updateFluid(fluidV3, fill: fillV3, basePos: posV3)

            // Update effect glow
            if let glow = effectGlow, let geo = glow.geometry as? SCNSphere {
                let mat = geo.firstMaterial!
                mat.diffuse.contents = UIColor.green.withAlphaComponent(CGFloat(fillEffect * 0.5))
                mat.emission.contents = UIColor.green.withAlphaComponent(CGFloat(fillEffect * 0.3))
            }

            // Update syringe
            let isInfusing = infusionRate > 0.0001
            if let sf = syringeFluid, let geo = sf.geometry as? SCNBox {
                let fluidAlpha: CGFloat = isInfusing ? 0.7 : 0.0
                geo.firstMaterial?.diffuse.contents = UIColor.systemRed.withAlphaComponent(fluidAlpha)
                geo.firstMaterial?.emission.contents = UIColor.systemRed.withAlphaComponent(isInfusing ? 0.3 : 0.0)
                geo.height = isInfusing ? 0.35 : 0.01
            }
            if let sp = syringePlunger {
                sp.position.y = isInfusing ? posSyringe.y + 0.35 : posSyringe.y + 0.5
            }

            // Sizes mode (scale compartments)
            glassV1?.scale = SCNVector3(Float(scaleV1), Float(scaleV1), Float(scaleV1))
            glassV2?.scale = SCNVector3(Float(scaleV2), Float(scaleV2), Float(scaleV2))
            glassV3?.scale = SCNVector3(Float(scaleV3), Float(scaleV3), Float(scaleV3))

            // Labels visibility
            for node in labelNodes {
                node.isHidden = !showLabels
            }

            // Size labels
            updateSizeLabels(scene: scene, show: showSizes, v1: volumeV1, v2: volumeV2, v3: volumeV3)

            // Particle birth rate based on infusion
            for pNode in particleSystems {
                if let ps = pNode.particleSystems?.first {
                    if pNode.name?.contains("syr") == true {
                        ps.birthRate = isInfusing ? 12 : 0
                    }
                }
            }

            SCNTransaction.commit()
        }

        private func updateFluid(_ node: SCNNode?, fill: Double, basePos: SCNVector3) {
            guard let node = node else { return }
            let clampedFill = min(max(fill, 0), 1)
            let fluidHeight = cylHeight * CGFloat(clampedFill)

            if let cyl = node.geometry as? SCNCylinder {
                cyl.height = max(fluidHeight, 0.001)
            }
            // Position: bottom of glass + half fluid height
            node.position = SCNVector3(
                basePos.x,
                basePos.y - Float(cylHeight / 2) + Float(fluidHeight / 2),
                basePos.z
            )
        }

        private func updateSizeLabels(scene: SCNScene, show: Bool, v1: Double, v2: Double, v3: Double) {
            // Remove old size labels
            for node in sizeNodes {
                node.removeFromParentNode()
            }
            sizeNodes.removeAll()

            guard show else { return }

            let volumes = [("V1", posV1, v1), ("V2", posV2, v2), ("V3", posV3, v3)]
            for (name, pos, vol) in volumes {
                let text = SCNText(string: "\(Int(vol)) ml", extrusionDepth: 0)
                text.font = UIFont.monospacedSystemFont(ofSize: 0.08, weight: .medium)
                text.flatness = 0.1
                let mat = SCNMaterial()
                mat.diffuse.contents = UIColor.white.withAlphaComponent(0.5)
                mat.lightingModel = .constant
                text.materials = [mat]

                let node = SCNNode(geometry: text)
                let (min, max) = text.boundingBox
                node.pivot = SCNMatrix4MakeTranslation((max.x - min.x) / 2 + min.x, (max.y - min.y) / 2 + min.y, 0)
                node.position = SCNVector3(pos.x, pos.y - Float(cylHeight / 2) - 0.15, pos.z)
                node.constraints = [SCNBillboardConstraint()]
                node.name = "size_\(name)"

                scene.rootNode.addChildNode(node)
                sizeNodes.append(node)
            }
        }
    }
}
