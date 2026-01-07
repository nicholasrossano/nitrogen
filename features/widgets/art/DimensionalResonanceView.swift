import SwiftUI

struct DimensionalResonanceView: View {
    @State private var time: Double = 0
    
    let layerCount = 5
    let sizeFactor: Double = 1.125
    let movementFactor: Double = 1.1
    let rotationFactor: Double = 1.8
    
    let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
    
    var body: some View {
        Canvas { context, size in
            context.fill(
                Path(CGRect(origin: .zero, size: size)),
                with: .color(.white)
            )
            
            let centerAdjustX = (size.width / 2) - (275 * sizeFactor)
            let centerAdjustY = (size.height / 2) - (225 * sizeFactor)
            
            let baseForms = [
                SpiralForm(
                    centerX: 225 * sizeFactor + centerAdjustX,
                    centerY: 200 * sizeFactor + centerAdjustY,
                    radiusX: 120 * sizeFactor,
                    radiusY: 120 * sizeFactor,
                    rotation: 0,
                    phase: 0
                ),
                SpiralForm(
                    centerX: 350 * sizeFactor + centerAdjustX,
                    centerY: 175 * sizeFactor + centerAdjustY,
                    radiusX: 110 * sizeFactor,
                    radiusY: 115 * sizeFactor,
                    rotation: Double.pi / 6,
                    phase: 2
                ),
                SpiralForm(
                    centerX: 275 * sizeFactor + centerAdjustX,
                    centerY: 325 * sizeFactor + centerAdjustY,
                    radiusX: 115 * sizeFactor,
                    radiusY: 110 * sizeFactor,
                    rotation: -Double.pi / 4,
                    phase: 4
                )
            ]
            
            for i in 0..<layerCount {
                let depth = Double(i) / Double(layerCount - 1)
                
                for baseForm in baseForms {
                    let scale = 0.8 + depth * 0.4
                    let form = LayerForm(
                        centerX: baseForm.centerX + (depth - 0.5) * 30 * sizeFactor,
                        centerY: baseForm.centerY + (depth - 0.5) * 20 * sizeFactor,
                        radiusX: baseForm.radiusX * scale,
                        radiusY: baseForm.radiusY * scale,
                        rotation: baseForm.rotation + depth * Double.pi * 0.1,
                        phase: baseForm.phase,
                        depth: depth,
                        lineCount: Int(30 - depth * 15),
                        lineWidth: 0.5 + depth * 0.7,
                        opacity: 0.2 + depth * 0.8,
                        speed: (0.5 + depth * 1.5) * movementFactor
                    )
                    
                    drawSpiralForm(context: context, form: form, time: time)
                }
            }
        }
        .frame(width: 550, height: 550)
		.background(Color.clear)
        .onReceive(timer) { _ in
            time += 0.005
        }
    }
    
    func drawSpiralForm(context: GraphicsContext, form: LayerForm, time: Double) {
        let breathFactor = sin(time * 0.2 * form.speed + form.phase) * 0.15 * movementFactor + 1
        let currentRadiusX = form.radiusX * breathFactor
        let currentRadiusY = form.radiusY * breathFactor
        
        let oscillatingRotation = sin(time * 0.15) * 0.2 * rotationFactor
        let currentRotation = form.rotation + oscillatingRotation
        
        for i in 0..<form.lineCount {
            let scale = Double(i) / Double(form.lineCount)
            let currentScale = scale * 0.9
            
            var path = Path()
            var isFirst = true
            
            var angle: Double = 0
            while angle <= Double.pi * 2 {
                let spiralOffset = angle * 0.2
                let r = currentScale + sin(angle * 8 + time * 0.1 * form.speed + form.phase) * 0.008 * movementFactor
                
                let waveX = sin(angle * 4 + time * 0.1 * form.speed) * form.radiusX * 0.03 * scale * movementFactor
                let waveY = cos(angle * 4 + time * 0.1 * form.speed) * form.radiusY * 0.03 * scale * movementFactor
                
                let rX = currentRadiusX * r * cos(angle + spiralOffset + currentRotation + time * 0.02 * form.speed)
                let rY = currentRadiusY * r * sin(angle + spiralOffset + currentRotation + time * 0.02 * form.speed)
                
                let x = form.centerX + rX + waveX
                let y = form.centerY + rY + waveY
                let point = CGPoint(x: x, y: y)
                
                if isFirst {
                    path.move(to: point)
                    isFirst = false
                } else {
                    path.addLine(to: point)
                }
                
                angle += 0.05
            }
            
            path.closeSubpath()
            
            let lineOpacity = form.opacity * (0.2 + scale * 0.8)
			let strokeColor = Color("Beige").opacity(lineOpacity)
            
            context.stroke(
                path,
                with: .color(strokeColor),
                lineWidth: form.lineWidth
            )
        }
    }
}

struct SpiralForm {
    let centerX: Double
    let centerY: Double
    let radiusX: Double
    let radiusY: Double
    let rotation: Double
    let phase: Double
}

struct LayerForm {
    let centerX: Double
    let centerY: Double
    let radiusX: Double
    let radiusY: Double
    let rotation: Double
    let phase: Double
    let depth: Double
    let lineCount: Int
    let lineWidth: Double
    let opacity: Double
    let speed: Double
}
