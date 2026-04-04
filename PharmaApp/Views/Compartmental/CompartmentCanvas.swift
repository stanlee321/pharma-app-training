import SwiftUI

/// 2D canvas rendering compartment cylinders, pipes, particles, and fluid levels.
/// Uses gradients and shapes to give a pseudo-3D appearance.
struct CompartmentCanvas: View {
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
    // Rate constants for particles
    let k12: Double
    let k21: Double
    let k13: Double
    let k31: Double
    let k10: Double
    let ke0: Double
    let time: Double

    var body: some View {
        Canvas { context, size in
            let w = size.width
            let h = size.height

            // Layout positions
            let centerX = w * 0.5
            let centerY = h * 0.45

            // Cylinder dimensions (base)
            let cylW: CGFloat = 60
            let cylH: CGFloat = 90

            // V1 (central) — center
            let v1Rect = CGRect(
                x: centerX - cylW * scaleV1 / 2,
                y: centerY - cylH * scaleV1 / 2,
                width: cylW * scaleV1,
                height: cylH * scaleV1
            )

            // V2 (rapid peripheral) — top right
            let v2Rect = CGRect(
                x: centerX + 80 - cylW * scaleV2 / 2,
                y: centerY - 70 - cylH * scaleV2 / 2,
                width: cylW * scaleV2,
                height: cylH * scaleV2
            )

            // V3 (slow peripheral) — bottom right
            let v3Rect = CGRect(
                x: centerX + 80 - cylW * scaleV3 / 2,
                y: centerY + 50 - cylH * scaleV3 / 2,
                width: cylW * scaleV3,
                height: cylH * scaleV3
            )

            // Effect site — left
            let effectRect = CGRect(
                x: centerX - 120,
                y: centerY - 20,
                width: 40, height: 40
            )

            // Syringe — far left
            let syringeRect = CGRect(
                x: 15,
                y: centerY - 30,
                width: 35, height: 60
            )

            // Draw pipes first (behind cylinders)
            drawPipe(context: &context, from: v1Rect, to: v2Rect, rate: k12 - k21, time: time, color: .cyan)
            drawPipe(context: &context, from: v1Rect, to: v3Rect, rate: k13 - k31, time: time, color: .teal)
            drawPipe(context: &context, from: v1Rect, to: effectRect, rate: ke0, time: time, color: .green)

            // Syringe → V1 pipe
            if infusionRate > 0 {
                drawPipe(context: &context, from: syringeRect, to: v1Rect, rate: infusionRate * 100, time: time, color: .red)
            }

            // Clearance pipe (V1 → bottom)
            let clearanceStart = CGPoint(x: v1Rect.midX, y: v1Rect.maxY)
            let clearanceEnd = CGPoint(x: v1Rect.midX, y: h - 10)
            drawArrowPipe(context: &context, from: clearanceStart, to: clearanceEnd, rate: k10, time: time, color: .gray)

            // Draw syringe
            drawSyringe(context: &context, rect: syringeRect, active: infusionRate > 0)

            // Draw cylinders
            drawCylinder(context: &context, rect: v1Rect, fill: fillV1, color: .red, label: "V1", volume: volumeV1)
            drawCylinder(context: &context, rect: v2Rect, fill: fillV2, color: .cyan, label: "V2", volume: volumeV2)
            drawCylinder(context: &context, rect: v3Rect, fill: fillV3, color: .teal, label: "V3", volume: volumeV3)

            // Effect site (smaller, different shape)
            drawEffectSite(context: &context, rect: effectRect, fill: fillEffect)

            // Clearance label
            if showLabels {
                let clText = Text("CL").font(.system(size: 9, weight: .medium)).foregroundColor(.gray)
                context.draw(clText, at: CGPoint(x: v1Rect.midX + 12, y: h - 18))
            }
        }
    }

    // MARK: - Cylinder Drawing

    private func drawCylinder(
        context: inout GraphicsContext, rect: CGRect,
        fill: Double, color: Color, label: String, volume: Double
    ) {
        let cornerRadius: CGFloat = 10

        // Glass body (semi-transparent)
        let bodyPath = RoundedRectangle(cornerRadius: cornerRadius)
            .path(in: rect)
        context.fill(bodyPath, with: .color(.white.opacity(0.08)))
        context.stroke(bodyPath, with: .color(.white.opacity(0.3)), lineWidth: 1)

        // Fluid fill (from bottom)
        if fill > 0 {
            let fillHeight = rect.height * CGFloat(min(fill, 1))
            let fillRect = CGRect(
                x: rect.minX + 2,
                y: rect.maxY - fillHeight,
                width: rect.width - 4,
                height: fillHeight - 2
            )
            let fluidPath = RoundedRectangle(cornerRadius: cornerRadius - 2)
                .path(in: fillRect)

            // Gradient for pseudo-3D look
            let gradient = Gradient(colors: [
                color.opacity(0.7),
                color.opacity(0.4),
                color.opacity(0.6)
            ])
            context.fill(fluidPath, with: .linearGradient(
                gradient,
                startPoint: CGPoint(x: fillRect.minX, y: fillRect.minY),
                endPoint: CGPoint(x: fillRect.maxX, y: fillRect.maxY)
            ))
        }

        // Glass highlight (left edge)
        let highlightRect = CGRect(x: rect.minX + 3, y: rect.minY + 5, width: 4, height: rect.height - 10)
        let highlightPath = RoundedRectangle(cornerRadius: 2).path(in: highlightRect)
        context.fill(highlightPath, with: .color(.white.opacity(0.15)))

        // Label
        if showLabels {
            let labelText = Text(label)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white.opacity(0.8))
            context.draw(labelText, at: CGPoint(x: rect.midX, y: rect.minY - 10))
        }

        // Volume label in Sizes mode
        if showSizes {
            let volText = Text("\(Int(volume)) ml")
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(.white.opacity(0.6))
            context.draw(volText, at: CGPoint(x: rect.midX, y: rect.maxY + 10))
        }

        // Data overlay
        if showData {
            let pct = String(format: "%.0f%%", fill * 100)
            let dataText = Text(pct)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(.white)
            context.draw(dataText, at: CGPoint(x: rect.midX, y: rect.midY))
        }
    }

    // MARK: - Effect Site

    private func drawEffectSite(context: inout GraphicsContext, rect: CGRect, fill: Double) {
        // Diamond/hexagon shape for effect site
        let path = Path { p in
            p.move(to: CGPoint(x: rect.midX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            p.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
            p.closeSubpath()
        }

        context.fill(path, with: .color(.white.opacity(0.06)))
        context.stroke(path, with: .color(.green.opacity(0.5)), lineWidth: 1)

        // Fill
        if fill > 0 {
            context.fill(path, with: .color(.green.opacity(0.3 * fill)))
        }

        if showLabels {
            let text = Text("Effect")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.green.opacity(0.8))
            context.draw(text, at: CGPoint(x: rect.midX, y: rect.minY - 8))
        }
    }

    // MARK: - Syringe

    private func drawSyringe(context: inout GraphicsContext, rect: CGRect, active: Bool) {
        let bodyColor: Color = active ? .red.opacity(0.6) : .gray.opacity(0.3)

        // Barrel
        let barrel = CGRect(x: rect.minX + 5, y: rect.minY, width: rect.width - 10, height: rect.height - 10)
        let barrelPath = RoundedRectangle(cornerRadius: 4).path(in: barrel)
        context.fill(barrelPath, with: .color(bodyColor))
        context.stroke(barrelPath, with: .color(.white.opacity(0.3)), lineWidth: 0.5)

        // Needle
        var needlePath = Path()
        needlePath.move(to: CGPoint(x: rect.midX, y: rect.maxY - 10))
        needlePath.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        context.stroke(needlePath, with: .color(.white.opacity(0.5)), lineWidth: 2)

        // Plunger
        let plungerY = active ? rect.minY + rect.height * 0.3 : rect.minY + 4
        var plungerPath = Path()
        plungerPath.move(to: CGPoint(x: rect.minX + 8, y: plungerY))
        plungerPath.addLine(to: CGPoint(x: rect.maxX - 8, y: plungerY))
        context.stroke(plungerPath, with: .color(.white.opacity(0.6)), lineWidth: 2)

        // Push rod
        var rodPath = Path()
        rodPath.move(to: CGPoint(x: rect.midX, y: rect.minY - 8))
        rodPath.addLine(to: CGPoint(x: rect.midX, y: plungerY))
        context.stroke(rodPath, with: .color(.white.opacity(0.4)), lineWidth: 1.5)

        if showLabels {
            let text = Text("IV")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(.white.opacity(0.5))
            context.draw(text, at: CGPoint(x: rect.midX, y: rect.minY - 16))
        }
    }

    // MARK: - Pipes & Particles

    private func drawPipe(
        context: inout GraphicsContext,
        from: CGRect, to: CGRect,
        rate: Double, time: Double, color: Color
    ) {
        let start = CGPoint(x: from.midX, y: from.midY)
        let end = CGPoint(x: to.midX, y: to.midY)

        // Pipe line
        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        context.stroke(path, with: .color(.white.opacity(0.15)), lineWidth: 3)
        context.stroke(path, with: .color(color.opacity(0.2)), lineWidth: 1.5)

        // Particles along pipe
        let absRate = abs(rate)
        guard absRate > 0.001 else { return }
        let count = min(Int(absRate * 8) + 2, 8)
        let speed = absRate * 0.3

        for i in 0..<count {
            let offset = Double(i) / Double(count)
            var frac = (speed * time * 0.02 + offset).truncatingRemainder(dividingBy: 1.0)
            if rate < 0 { frac = 1.0 - frac }  // reverse direction

            let px = start.x + CGFloat(frac) * (end.x - start.x)
            let py = start.y + CGFloat(frac) * (end.y - start.y)

            let dotRect = CGRect(x: px - 2.5, y: py - 2.5, width: 5, height: 5)
            context.fill(Circle().path(in: dotRect), with: .color(color.opacity(0.8)))
        }
    }

    private func drawArrowPipe(
        context: inout GraphicsContext,
        from: CGPoint, to: CGPoint,
        rate: Double, time: Double, color: Color
    ) {
        var path = Path()
        path.move(to: from)
        path.addLine(to: to)
        context.stroke(path, with: .color(color.opacity(0.2)), lineWidth: 2)

        // Arrow head
        let arrowSize: CGFloat = 6
        var arrow = Path()
        arrow.move(to: CGPoint(x: to.x - arrowSize, y: to.y - arrowSize))
        arrow.addLine(to: to)
        arrow.addLine(to: CGPoint(x: to.x + arrowSize, y: to.y - arrowSize))
        context.stroke(arrow, with: .color(color.opacity(0.4)), lineWidth: 1.5)

        // Particles
        guard rate > 0.001 else { return }
        for i in 0..<3 {
            let offset = Double(i) / 3.0
            let frac = (rate * 0.3 * time * 0.02 + offset).truncatingRemainder(dividingBy: 1.0)
            let px = from.x + CGFloat(frac) * (to.x - from.x)
            let py = from.y + CGFloat(frac) * (to.y - from.y)
            let dotRect = CGRect(x: px - 2, y: py - 2, width: 4, height: 4)
            context.fill(Circle().path(in: dotRect), with: .color(color.opacity(0.5)))
        }
    }
}
