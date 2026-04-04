import SwiftUI

/// Custom Canvas chart with dual Y-axes, colored curves, and grid.
struct ChartCanvas: View {
    let points: [CurvePoint]
    let timeRangeMinutes: Double
    let maxConcentration: Double
    let maxInfusionRate: Double
    let concentrationUnit: String
    let cursorFraction: Double
    let compact: Bool

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
            drawCurves(context: &context, rect: chartRect)
            drawCursor(context: &context, rect: chartRect)
        }
        .background(Color.black)
    }

    // MARK: - Coordinate Mapping

    private func xForTime(_ t: Double, in rect: CGRect) -> CGFloat {
        let fraction = t / (timeRangeMinutes * 60)
        return rect.minX + CGFloat(fraction) * rect.width
    }

    private func yForConcentration(_ c: Double, in rect: CGRect) -> CGFloat {
        let fraction = c / maxConcentration
        return rect.maxY - CGFloat(fraction) * rect.height
    }

    private func yForInfusionRate(_ r: Double, in rect: CGRect) -> CGFloat {
        let fraction = r / maxInfusionRate
        return rect.maxY - CGFloat(fraction) * rect.height
    }

    // MARK: - Grid

    private func drawGrid(context: inout GraphicsContext, rect: CGRect) {
        let gridColor = Color.white.opacity(0.1)

        // Horizontal grid (concentration ticks)
        let ySteps = niceSteps(max: maxConcentration, count: compact ? 3 : 5)
        for val in ySteps {
            let y = yForConcentration(val, in: rect)
            var path = Path()
            path.move(to: CGPoint(x: rect.minX, y: y))
            path.addLine(to: CGPoint(x: rect.maxX, y: y))
            context.stroke(path, with: .color(gridColor), lineWidth: 0.5)
        }

        // Vertical grid (time ticks)
        let xSteps = niceSteps(max: timeRangeMinutes, count: compact ? 4 : 6)
        for val in xSteps {
            let x = xForTime(val * 60, in: rect)
            var path = Path()
            path.move(to: CGPoint(x: x, y: rect.minY))
            path.addLine(to: CGPoint(x: x, y: rect.maxY))
            context.stroke(path, with: .color(gridColor), lineWidth: 0.5)
        }
    }

    // MARK: - Axes Labels

    private func drawAxes(context: inout GraphicsContext, rect: CGRect, canvasSize: CGSize) {
        let labelFont: Font = compact ? .system(size: 8) : .system(size: 10)
        let labelColor = Color.white.opacity(0.6)

        // Left Y-axis labels (concentration)
        let ySteps = niceSteps(max: maxConcentration, count: compact ? 3 : 5)
        for val in ySteps {
            let y = yForConcentration(val, in: rect)
            let text = Text(formatAxisValue(val)).font(labelFont).foregroundColor(labelColor)
            context.draw(text, at: CGPoint(x: leftMargin - 4, y: y), anchor: .trailing)
        }

        // Right Y-axis labels (infusion rate)
        if !compact {
            let rSteps = niceSteps(max: maxInfusionRate, count: 4)
            for val in rSteps {
                let y = yForInfusionRate(val, in: rect)
                let text = Text(formatAxisValue(val)).font(labelFont).foregroundColor(.orange.opacity(0.6))
                context.draw(text, at: CGPoint(x: canvasSize.width - rightMargin + 4, y: y), anchor: .leading)
            }
        }

        // X-axis labels (time in minutes)
        let xSteps = niceSteps(max: timeRangeMinutes, count: compact ? 4 : 6)
        for val in xSteps {
            let x = xForTime(val * 60, in: rect)
            let text = Text("\(Int(val))").font(labelFont).foregroundColor(labelColor)
            context.draw(text, at: CGPoint(x: x, y: rect.maxY + (compact ? 10 : 14)), anchor: .center)
        }
    }

    // MARK: - Curves

    private func drawCurves(context: inout GraphicsContext, rect: CGRect) {
        guard points.count > 1 else { return }

        // Plasma concentration — cyan
        drawCurvePath(
            context: &context, rect: rect,
            values: points.map { ($0.time, $0.plasmaConcentration) },
            mapY: { yForConcentration($0, in: rect) },
            color: .cyan, lineWidth: compact ? 1.5 : 2
        )

        // Effect-site concentration — green
        drawCurvePath(
            context: &context, rect: rect,
            values: points.map { ($0.time, $0.effectConcentration) },
            mapY: { yForConcentration($0, in: rect) },
            color: .green, lineWidth: compact ? 1 : 1.5
        )

        // Infusion rate — orange (right Y-axis)
        if !compact {
            drawCurvePath(
                context: &context, rect: rect,
                values: points.map { ($0.time, $0.infusionRate * 60) },  // mg/min → mg/hr for display
                mapY: { yForInfusionRate($0, in: rect) },
                color: .orange, lineWidth: 1
            )
        }
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
            let y = mapY(point.1)
            let clampedY = max(rect.minY, min(rect.maxY, y))
            if i == 0 {
                path.move(to: CGPoint(x: x, y: clampedY))
            } else {
                path.addLine(to: CGPoint(x: x, y: clampedY))
            }
        }
        context.stroke(path, with: .color(color), lineWidth: lineWidth)
    }

    // MARK: - Cursor

    private func drawCursor(context: inout GraphicsContext, rect: CGRect) {
        let x = rect.minX + CGFloat(cursorFraction) * rect.width
        var path = Path()
        path.move(to: CGPoint(x: x, y: rect.minY))
        path.addLine(to: CGPoint(x: x, y: rect.maxY))
        context.stroke(path, with: .color(.blue), lineWidth: 1.5)
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
        while v <= max {
            result.append(v)
            v += step
        }
        return result
    }

    private func formatAxisValue(_ v: Double) -> String {
        if v >= 100 { return String(format: "%.0f", v) }
        if v >= 10 { return String(format: "%.0f", v) }
        if v >= 1 { return String(format: "%.1f", v) }
        return String(format: "%.2f", v)
    }
}
