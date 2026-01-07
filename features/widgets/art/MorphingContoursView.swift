import SwiftUI

struct MorphingContoursView: View {
	@State private var time: Double = 0
	private let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
	
	var body: some View {
		Canvas { context, size in
			drawMorphingContours(context: context, size: size, time: time)
		}
		.background(Color.clear)
		.onReceive(timer) { _ in time += 0.001 }
	}
	
	private func drawMorphingContours(context: GraphicsContext, size: CGSize, time: Double) {
		let width        = size.width
		let height       = size.height
		let numShapes    = 3
		let contoursEach = 25
		let points       = 100
		let scaleFactor  = 1.5
		let centerX      = width  / 2
		let centerY      = height / 2
		
		for shapeIndex in 0..<numShapes {
			let phase = time + Double(shapeIndex) * .pi * 2 / Double(numShapes)
			let offsetR = 20 * scaleFactor
			let offsetA = phase * 0.3
			let baseX   = cos(offsetA) * offsetR
			let baseY   = sin(offsetA) * offsetR
			
			var layers: [(c:Int, s:Double, ox:Double, oy:Double, a:Double, z:Double)] = []
			
			for c in 0..<contoursEach {
				let s = (30 + Double(c) * 3) * scaleFactor
				let cr = 5 * scaleFactor
				let ca = Double(c)*0.1 + phase*0.5
				let cx = cos(ca) * cr
				let cy = sin(ca) * cr
				
				let z  = sin(time*2 + Double(c)*0.2 + phase) * 0.5 + 0.5
				let p  = 1 - z * 0.3
				let a  = 0.1 + z * 0.4
				
				layers.append((c, s*p, (baseX+cx)*p, (baseY+cy)*p, a, z))
			}
			layers.sort { $0.z < $1.z }
			
			for L in layers {
				var path = Path(); var first = true
				
				for i in 0...points {
					let ang = Double(i)/Double(points) * .pi*2
					var r = L.s
					r += 8 * sin(ang*2 + phase*1.5) * scaleFactor * (0.8 + L.z*0.4)
					r += 5 * cos(ang*3 - phase*0.8) * scaleFactor * (0.8 + L.z*0.4)
					r += 3 * sin(ang*4 + Double(L.c)*0.05) * scaleFactor * (0.8 + L.z*0.4)
					
					let x = centerX + L.ox + cos(ang) * r
					let y = centerY + L.oy + sin(ang) * r
					
					if first { path.move(to: .init(x: x, y: y)); first = false }
					else     { path.addLine(to: .init(x: x, y: y)) }
				}
				path.closeSubpath()
				
				context.stroke(
					path,
					with: .color(Color("Beige").opacity(L.a)),
					lineWidth: 0.8 * (0.5 + L.z * 0.5)
				)
				
				// subtle drop-shadow for foreground layers
				if L.z > 0.7 {
					var sp = Path(); var firstS = true
					for i in 0...points {
						let ang = Double(i)/Double(points) * .pi*2
						var r = L.s
						r += 8 * sin(ang*2 + phase*1.5) * scaleFactor * (0.8 + L.z*0.4)
						r += 5 * cos(ang*3 - phase*0.8) * scaleFactor * (0.8 + L.z*0.4)
						r += 3 * sin(ang*4 + Double(L.c)*0.05) * scaleFactor * (0.8 + L.z*0.4)
						let x = centerX + L.ox + cos(ang)*r + 1
						let y = centerY + L.oy + sin(ang)*r + 1
						if firstS { sp.move(to: .init(x: x, y: y)); firstS = false }
						else      { sp.addLine(to: .init(x: x, y: y)) }
					}
					sp.closeSubpath()
					
					context.stroke(
						sp,
						with: .color(Color("Beige").opacity(L.a * 0.3)),
						lineWidth: 2
					)
				}
			}
		}
	}
}
