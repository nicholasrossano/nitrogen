import SwiftUI

struct MetamorphosisView: View {
	@State private var time: Double = 5000
	private let timer = Timer.publish(every: 1/60, on: .main, in: .common).autoconnect()
	
	private let numLines = 120
	private let lineSegments = 180
	private let lineWidth: CGFloat = 0.6
	private let rotateSpeed = 0.00025
	
	var body: some View {
		Canvas { context, size in
			let width  = size.width
			let height = size.height
			
			let rotateZ = time * rotateSpeed * 0.1
			
			// Main lines
			for i in 0..<numLines {
				let v = Double(i) / Double(numLines - 1)
				var path = Path()
				var lastVisible = false
				
				for j in 0...lineSegments {
					let u = Double(j) / Double(lineSegments)
					let p = getCurrentForm(u: u, v: v, t: time)
					
					let rx = p.x * cos(rotateZ) - p.y * sin(rotateZ)
					let ry = p.x * sin(rotateZ) + p.y * cos(rotateZ)
					let rz = p.z
					
					let scale = 1.5 + rz * 0.001
					let px = width  / 2 + rx * scale
					let py = height / 2 + ry * scale
					let visible = rz < 50
					
					if j == 0 {
						if visible { path.move(to: .init(x: px, y: py)); lastVisible = true }
					} else {
						if visible && lastVisible { path.addLine(to: .init(x: px, y: py)) }
						else if visible { path.move(to: .init(x: px, y: py)) }
					}
					lastVisible = visible
				}
				
				context.stroke(path, with: .color(Color("Beige")), lineWidth: lineWidth)
			}
			
			// Secondary lines
			let secondaryLines = Int(Double(numLines) * 0.3)
			for i in 0..<secondaryLines {
				let u = Double(i) / Double(secondaryLines - 1)
				var path = Path()
				var lastVisible = false
				
				let secondarySegments = Int(Double(lineSegments) * 0.5)
				for j in 0...secondarySegments {
					let v = Double(j) / Double(secondarySegments)
					let p = getCurrentForm(u: u, v: v, t: time)
					
					let rx = p.x * cos(rotateZ) - p.y * sin(rotateZ)
					let ry = p.x * sin(rotateZ) + p.y * cos(rotateZ)
					let rz = p.z
					
					let scale = 1.5 + rz * 0.001
					let px = width  / 2 + rx * scale
					let py = height / 2 + ry * scale
					let visible = rz < 50
					
					if j == 0 {
						if visible { path.move(to: .init(x: px, y: py)); lastVisible = true }
					} else {
						if visible && lastVisible { path.addLine(to: .init(x: px, y: py)) }
						else if visible { path.move(to: .init(x: px, y: py)) }
					}
					lastVisible = visible
				}
				
				context.stroke(path, with: .color(Color("Beige")), lineWidth: lineWidth * 0.7)
			}
		}
		.background(Color.clear)          // transparent view background
		.onReceive(timer) { _ in time += 0.5 }
	}
	
	private func getCurrentForm(u: Double, v: Double, t: Double) -> Point3D {
		let forms = 3
		let cycle: Double = 600
		let pos = (t.remainder(dividingBy: cycle * Double(forms))) / cycle
		let idx = Int(pos)
		let next = (idx + 1) % forms
		let raw = pos - Double(idx)
		
		let blend: Double = raw < 0.5
		? 4 * pow(raw, 3)
		: 1 - pow(-2 * raw + 2, 3) / 2
		
		let a = getForm(idx, u: u, v: v, t: t)
		let b = getForm(next, u: u, v: v, t: t)
		return .init(
			x: a.x * (1 - blend) + b.x * blend,
			y: a.y * (1 - blend) + b.y * blend,
			z: a.z * (1 - blend) + b.z * blend
		)
	}
	
	private func getForm(_ i: Int, u: Double, v: Double, t: Double) -> Point3D {
		let θ = u * .pi * 2
		let φ = v * .pi
		
		switch i {
		case 0:
			var r = 120 + 8 * sin(φ * 4 + θ * 2)
			r += 6 * sin(φ * 6) * cos(θ * 3)
			return Point3D(
				x: r * sin(φ) * cos(θ),
				y: r * sin(φ) * sin(θ),
				z: r * cos(φ) + 6 * sin(θ * 5 + φ * 3)
			)
			
		case 1:
			var r = 125 + 8 * cos(φ * 8)
			r *= 0.9 + 0.1 * abs(cos(θ * 2))
			return Point3D(
				x: r * sin(φ) * cos(θ),
				y: r * sin(φ) * sin(θ),
				z: r * cos(φ) * (0.9 + 0.15 * sin(θ * 4))
			)
			
		default:
			var r: Double = 125
			r += 15 * sin(φ * 3) * sin(θ * 2.5)
			r += 10 * cos(φ * 5 + θ)
			let hollow = max(0, sin(φ * 2 + θ * 3) - 0.85)
			r *= 1 - hollow * 0.3
			return Point3D(
				x: r * sin(φ) * cos(θ),
				y: r * sin(φ) * sin(θ),
				z: r * cos(φ)
			)
		}
	}
}

struct Point3D { let x, y, z: Double }
