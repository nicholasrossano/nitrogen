import SwiftUI

// ─────────── FabricView (Canvas-based, transparent) ───────────
struct FabricView: View {
	@State private var time: Double = 0
	private let timer = Timer.publish(every: 0.016, on: .main, in: .common).autoconnect()
	
	// ─────────── Tunables ───────────
	private let speed: Double = 0.35
	private let heightScale: Double = 1.3
	private let maxHeight: Double = 1.0   // soft cap (world units, before projection)
	
	var body: some View {
		Canvas { context, size in
			drawFabric(context: context, size: size, time: time)
		}
		.background(Color.clear)
		.onReceive(timer) { _ in time += 0.016 }
	}
	
	// ─────────── Draw ───────────
	private func drawFabric(context: GraphicsContext, size: CGSize, time: Double) {
		let t = time * speed
		
		let resolution = 48
		let size3D: Double = 10
		let step = size3D / Double(resolution)
		let centerX = size.width  / 2
		let centerY = size.height / 2
		let scale = min(size.width, size.height) / 8.0
		
		let ax = .pi * 0.3 + cos(t * 0.08) * 0.05
		let ay = sin(t * 0.10) * 0.1
		let kPerspective = 0.15
		
		let sources = createWaveSources(time: t, scale: 3.5)
		
		var heightMap = Array(
			repeating: Array(repeating: 0.0, count: resolution + 1),
			count: resolution + 1
		)
		
		for i in 0...resolution {
			let x = Double(i) * step - size3D / 2
			for j in 0...resolution {
				let z = Double(j) * step - size3D / 2
				var h = 0.0
				for s in sources {
					let dx = x - s.px
					let dz = z - s.pz
					let d = sqrt(dx*dx + dz*dz)
					h += sin(d * s.frequency - t * 3 + s.phase) *
					s.amplitude * exp(-d * 0.3)
				}
				let scaled = h * heightScale
				heightMap[i][j] = softLimit(scaled, limit: maxHeight)
			}
		}
		
		let beige = Color("Beige")
		
		for i in 0...resolution {
			var path = Path()
			var first = true
			for j in 0...resolution {
				let x = Double(i) * step - size3D / 2
				let z = (Double(j) * step - size3D / 2) * 0.3
				let y = heightMap[i][j]
				let p = project(x: x, y: y, z: z, ax: ax, ay: ay, k: kPerspective, scale: scale, cx: centerX, cy: centerY)
				if first { path.move(to: p); first = false } else { path.addLine(to: p) }
			}
			context.stroke(path, with: .color(beige.opacity(0.9)), lineWidth: 1)
		}
		
		for j in 0...resolution {
			var path = Path()
			var first = true
			for i in 0...resolution {
				let x = Double(i) * step - size3D / 2
				let z = (Double(j) * step - size3D / 2) * 0.3
				let y = heightMap[i][j]
				let p = project(x: x, y: y, z: z, ax: ax, ay: ay, k: kPerspective, scale: scale, cx: centerX, cy: centerY)
				if first { path.move(to: p); first = false } else { path.addLine(to: p) }
			}
			context.stroke(path, with: .color(beige.opacity(0.9)), lineWidth: 1)
		}
	}
	
	// ─────────── Math helpers ───────────
	private func softLimit(_ x: Double, limit: Double) -> Double {
		guard limit > 0 else { return x }
		return x * limit / (abs(x) + limit)   // smooth, never exceeds ±limit
	}
	
	private func project(x: Double, y: Double, z: Double,
						 ax: Double, ay: Double, k: Double,
						 scale: Double, cx: CGFloat, cy: CGFloat) -> CGPoint {
		let cosY = cos(ay), sinY = sin(ay)
		let x1 = x * cosY + z * sinY
		let z1 = -x * sinY + z * cosY
		
		let cosX = cos(ax), sinX = sin(ax)
		let y2 = y * cosX - z1 * sinX
		let z2 = y * sinX + z1 * cosX
		
		let denom = 1.0 + z2 * k
		let xs = x1 / denom
		let ys = y2 / denom
		
		return CGPoint(x: cx + xs * scale, y: cy + ys * scale)
	}
	
	private struct WaveSource {
		let px: Double
		let py: Double
		let pz: Double
		let frequency: Double
		let amplitude: Double
		let phase: Double
	}
	
	private func createWaveSources(time: Double, scale: Double) -> [WaveSource] {
		var s: [WaveSource] = []
		let cnt = 8
		for i in 0..<cnt {
			let ang = Double(i) / Double(cnt) * .pi * 2
			let r = scale * (0.8 + sin(ang * 2 + time) * 0.3)
			s.append(WaveSource(
				px: cos(ang) * r,
				py: sin(time * 2 + ang) * 0.8,
				pz: sin(ang) * r * 0.3,
				frequency: 1.5 + sin(ang * 1.5) * 0.3,
				amplitude: 0.4 + cos(ang + time * 0.5) * 0.2,
				phase: time * 1.2 + ang
			))
		}
		s.append(WaveSource(px: 0, py: sin(time) * 0.4, pz: 0, frequency: 2, amplitude: 0.5, phase: time * 1.6))
		return s
	}
}
