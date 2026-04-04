import SwiftUI

/// Custom Canvas chart with dual Y-axes, colored curves, grid, and infusion area fill.
struct ChartCanvas: View {
    let points: [CurvePoint]
    let timeRangeMinutes: Double
    let maxConcentration: Double
    let maxInfusionRate: Double
    let concentrationUnit: String
    let cursorFraction: Double
    let compact: Bool
    var targetConcentration: Double? = nil  // horizontal dashed line
    var targetMarkers: [TargetEvent] = []     // triangles on X-axis per target

    // Chart margins
    private var leftMargin: CGFloat { compact ? 30 : 45 }
    private var rightMargin: CGFloat { compact ? 30 : 45 }
    private var topMargin: CGFloat { compact ? 8 : 16 }
    private var bottomMargin: CGFloat { compact ? 20 : 28 }

    var body: some View {
        Canvas { context, size in
            let chartRect = CGRect(
                x: leftMargin,
                y: topMargin,
                width: size.width - leftMargin - rightMargin,
                height: size.height - topMargin - bottomMargin
            )

            drawGrid(context: &context, rect: chartRect)
            drawAxes(context: &context, rect: chartRect, canvasSize: size)

            if !points.isEmpty {
                drawInfusionArea(context: &context, rect: chartRect)
                drawCurves(context: &context, rect: chartRect)
                drawInlineLabels(context: &context, rect: chartRect)
            }

            if let tc = targetConcentration, tc > 0 {
                drawTargetLine(context: &context, rect: chartRect, concentration: tc)
            }

            if !targetMarkers.isEmpty {
                drawTargetMarkers(context: &context, rect: chartRect)
            }
            drawCursor(context: &context, rect: chartRect)
        }
        .background(AppColors.darkBg)
    }

    // MARK: - Coordinate Mapping

    func xForTime(_ t: Double, in rect: CGRect) -> CGFloat {
        let fraction = t / (timeRangeMinutes * 60)
        return rect.minX + CGFloat(fraction) * rect.width
    }

    func yForConcentration(_ c: Double, in rect: CGRect) -> CGFloat {
        let fraction = c / maxConcentration
        return rect.maxY - CGFloat(fraction) * rect.height
    }

    private func yForInfusionRate(_ r: Double, in rect: CGRect) -> CGFloat {
        let fraction = r / maxInfusionRate
        return rect.maxY - CGFloat(fraction) * rect.height
    }

    // MARK: - Grid (improved contrast)

    private func drawGrid(context: inout GraphicsContext, rect: CGRect) {
        // Horizontal grid (concentration ticks)
        let ySteps = niceSteps(max: maxConcentration, count: compact ? 3 : 5)
        for val in ySteps {
            let y = yForConcentration(val, in: rect)
            var path = Path()
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            context.stroke(path, with: .color(AppColors.gridLineMajor), lineWidth: 0.5)
        }

        // Vertical grid (time ticks — major)
        let xSteps = niceSteps(max: timeRangeMinutes, count: compact ? 4 : 6)
        for val in xSteps {
            let x = xForTime(val * 60, in: rect)
            var path = Path()
            path.move(to: CGPoint(x: x, y: rect.minY))
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            context.stroke(path, with: .color(AppColors.gridLineMajor), lineWidth: 0.5)
        }

        // Vertical grid (minor — halfway between major)
        if !compact, let step = xSteps.first {
            let halfStep = step / 2
            var v = halfStep
            while v < timeRangeMinutes {
                if !xSteps.contains(v) {
                    let x = xForTime(v * 60, in: rect)
                    var path = Path()
                    path.move(to: CGPoint(x: x, y: rect.minY))
                    path.addLine(to: CGPoint(x: x, y: rect.maxY))
                    context.stroke(path, with: .color(AppColors.gridLine), lineWidth: 0.5)
                }
                v += halfStep
            }
        }
    }

    // MARK: - Axes Labels

    private func drawAxes(context: inout GraphicsContext, rect: CGRect, canvasSize: CGSize) {
        let labelFont: Font = compact ? .system(size: 8) : .system(size: 10, design: .monospaced)
        let labelColor = AppColors.axisText

        let ySteps = niceSteps(max: maxConcentration, count: compact ? 3 : 5)
        for val in ySteps {
            let y = yForConcentration(val, in: rect)
            let text = Text(formatAxisValue(val)).font(labelFont).foregroundColor(labelColor)
            context.draw(text, at: CGPoint(x: leftMargin - 4, y: y), anchor: .trailing)
        }

        // Right Y-axis (infusion rate) — increased contrast
        if !compact {
            let rSteps = niceSteps(max: maxInfusionRate, count: 4)
            for val in rSteps {
                let y = yForInfusionRate(val, in: rect)
                let text = Text(formatAxisValue(val))
                    .font(labelFont)
                    .foregroundColor(AppColors.infusion.opacity(0.8))
                context.draw(text, at: CGPoint(x: canvasSize.width - rightMargin + 4, y: y), anchor: .leading)
            }
        }

        let xSteps = niceSteps(max: timeRangeMinutes, count: compact ? 4 : 6)
        for val in xSteps {
            let x = xForTime(val * 60, in: rect)
            let text = Text("\(Int(val))").font(labelFont).foregroundColor(labelColor)
            context.draw(text, at: CGPoint(x: x, y: rect.maxY + (compact ? 10 : 14)), anchor: .center)
        }
    }

    // MARK: - Infusion Rate Filled Area

    private func drawInfusionArea(context: inout GraphicsContext, rect: CGRect) {
        guard !compact, points.count > 1 else { return }

        var areaPath = Path()
        let values = points.map { ($0.time, $0.infusionRate * 60) }

        areaPath.move(to: CGPoint(x: xForTime(values[0].0, in: rect), y: rect.maxY))
        for point in values {
            let x = xForTime(point.0, in: rect)
            let y = max(rect.minY, min(rect.maxY, yForInfusionRate(point.1, in: rect)))
            areaPath.addLine(to: CGPoint(x: x, y: y))
        }
        areaPath.addLine(to: CGPoint(x: xForTime(values.last!.0, in: rect), y: rect.maxY))
        areaPath.closeSubpath()

        context.fill(areaPath, with: .color(AppColors.infusion.opacity(0.1)))

        // Stroke on top
        var linePath = Path()
        for (i, point) in values.enumerated() {
            let x = xForTime(point.0, in: rect)
            let y = max(rect.minY, min(rect.maxY, yForInfusionRate(point.1, in: rect)))
            if i == 0 { linePath.move(to: CGPoint(x: x, y: y)) }
            else { linePath.addLine(to: CGPoint(x: x, y: y)) }
        }
        context.stroke(linePath, with: .color(AppColors.infusion), lineWidth: 1.5)
    }

    // MARK: - Curves

    private func drawCurves(context: inout GraphicsContext, rect: CGRect) {
        guard points.count > 1 else { return }

        // Plasma — cyan
        drawCurvePath(
            context: &context, rect: rect,
            values: points.map { ($0.time, $0.plasmaConcentration) },
            mapY: { yForConcentration($0, in: rect) },
            color: AppColors.plasma, lineWidth: compact ? 1.5 : 2.5
        )

        // Effect — green
        drawCurvePath(
            context: &context, rect: rect,
            values: points.map { ($0.time, $0.effectConcentration) },
            mapY: { yForConcentration($0, in: rect) },
            color: AppColors.effect, lineWidth: compact ? 1 : 1.5
        )
    }

    private func drawCurvePath(
        context: inout GraphicsContext, rect: CGRect,
        values: [(Double, Double)],
        mapY: (Double) -> CGFloat,
        color: Color, lineWidth: CGFloat
    ) {
        var path = Path()
        for (i, point) in values.enumerated() {
            let x = xForTime(point.0, in: rect)
            let y = max(rect.minY, min(rect.maxY, mapY(point.1)))
            if i == 0 { path.move(to: CGPoint(x: x, y: y)) }
            else { path.addLine(to: CGPoint(x: x, y: y)) }
        }
        context.stroke(path, with: .color(color), lineWidth: lineWidth)
    }

    // MARK: - Inline Curve Labels

    private func drawInlineLabels(context: inout GraphicsContext, rect: CGRect) {
        guard !compact, let last = points.last else { return }
        let xEnd = rect.maxX + 4

        // Cp label
        let yCp = yForConcentration(last.plasmaConcentration, in: rect)
        let cpText = Text("Cp").font(.system(size: 9, weight: .bold)).foregroundColor(AppColors.plasma)
        context.draw(cpText, at: CGPoint(x: xEnd, y: max(rect.minY, min(rect.maxY, yCp))), anchor: .leading)

        // Ce label
        let yCe = yForConcentration(last.effectConcentration, in: rect)
        let ceText = Text("Ce").font(.system(size: 9, weight: .bold)).foregroundColor(AppColors.effect)
        let ceY = max(rect.minY, min(rect.maxY, yCe))
        // Offset if too close to Cp
        let offset: CGFloat = abs(yCp - yCe) < 14 ? 14 : 0
        context.draw(ceText, at: CGPoint(x: xEnd, y: ceY + offset), anchor: .leading)
    }

    // MARK: - Target Line

    private func drawTargetLine(context: inout GraphicsContext, rect: CGRect, concentration: Double) {
        let y = yForConcentration(concentration, in: rect)
        guard y >= rect.minY && y <= rect.maxY else { return }

        // Dashed horizontal line
        var path = Path()
        let dashLen: CGFloat = 6
        let gapLen: CGFloat = 4
        var x = rect.minX
        while x < rect.maxX {
            path.move(to: CGPoint(x: x, y: y))
            path.addLine(to: CGPoint(x: min(x + dashLen, rect.maxX), y: y))
            x += dashLen + gapLen
        }
        context.stroke(path, with: .color(AppColors.targetDashed), lineWidth: 1)

        // Value label on left
        let labelText = Text(formatAxisValue(concentration))
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundColor(AppColors.target)
        context.draw(labelText, at: CGPoint(x: rect.minX - 4, y: y), anchor: .trailing)
    }

    // MARK: - Target Markers

    private func drawTargetMarkers(context: inout GraphicsContext, rect: CGRect) {
        for (i, target) in targetMarkers.enumerated() {
            let x = xForTime(target.time, in: rect)
            guard x >= rect.minX && x <= rect.maxX else { continue }

            // Vertical dashed line at target time
            let dashLen: CGFloat = 3
            let gap: CGFloat = 3
            var dashPath = Path()
            var dy = rect.minY
            while dy < rect.maxY {
                dashPath.move(to: CGPoint(x: x, y: dy))
                dashPath.addLine(to: CGPoint(x: x, y: min(dy + dashLen, rect.maxY)))
                dy += dashLen + gap
            }
            context.stroke(dashPath, with: .color(AppColors.target.opacity(0.2)), lineWidth: 0.5)

            // Triangle marker on X-axis
            let triSize: CGFloat = 6
            let triY = rect.maxY
            var tri = Path()
            tri.move(to: CGPoint(x: x, y: triY + 2))
            tri.addLine(to: CGPoint(x: x - triSize, y: triY + 2 + triSize * 1.2))
            tri.addLine(to: CGPoint(x: x + triSize, y: triY + 2 + triSize * 1.2))
            tri.closeSubpath()
            context.fill(tri, with: .color(AppColors.target.opacity(0.7)))

            // Horizontal dashed line at this target's concentration
            let y = yForConcentration(target.concentration, in: rect)
            if y >= rect.minY && y <= rect.maxY {
                var hDash = Path()
                var hx = rect.minX
                while hx < rect.maxX {
                    hDash.move(to: CGPoint(x: hx, y: y))
                    hDash.addLine(to: CGPoint(x: min(hx + 4, rect.maxX), y: y))
                    hx += 7
                }
                context.stroke(hDash, with: .color(AppColors.target.opacity(0.15)), lineWidth: 0.5)
            }

            // Small concentration label near the marker
            if !compact {
                let label = Text(formatAxisValue(target.concentration))
                    .font(.system(size: 8, weight: .medium, design: .monospaced))
                    .foregroundColor(AppColors.target.opacity(0.6))
                context.draw(label, at: CGPoint(x: x, y: triY + 2 + triSize * 1.2 + 8), anchor: .center)
            }
        }
    }

    // MARK: - Cursor

    private func drawCursor(context: inout GraphicsContext, rect: CGRect) {
        let x = rect.minX + CGFloat(cursorFraction) * rect.width
        var path = Path()
        path.move(to: CGPoint(x: x, y: rect.minY))
        path.addLine(to: CGPoint(x: x, y: rect.maxY))
        context.stroke(path, with: .color(AppColors.target), lineWidth: 1.5)
    }

    // MARK: - Helpers

    private func niceSteps(max: Double, count: Int) -> [Double] {
        guard max > 0, count > 0 else { return [] }
        let rough = max / Double(count)
        let magnitude = pow(10, floor(log10(rough)))
        let normalized = rough / magnitude
        let nice: Double
        if normalized <= 1 { nice = 1 }
        else if normalized <= 2 { nice = 2 }
        else if normalized <= 5 { nice = 5 }
        else { nice = 10 }
        let step = nice * magnitude
        var result: [Double] = []
        var v = step
        while v <= max { result.append(v); v += step }
        return result
    }

    private func formatAxisValue(_ v: Double) -> String {
        if v >= 100 { return String(format: "%.0f", v) }
        if v >= 10 { return String(format: "%.0f", v) }
        if v >= 1 { return String(format: "%.1f", v) }
        return String(format: "%.2f", v)
    }
}
