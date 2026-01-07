import SwiftUI

struct OrbView: View {
	private struct LoopConfig {
		let phaseOffset: Double
		let amplitude: CGFloat
		let frequency: Double
		let speed: Double
		let lineWidth: CGFloat
	}
	
	@State private var configs: [LoopConfig]
	private let radiusRatio: CGFloat
	
	init(radiusRatio: CGFloat = 0.35, loopCount: Int = 6) {
		self.radiusRatio = radiusRatio
		
		var tmp = [LoopConfig]()
		for _ in 0..<loopCount {
			tmp.append(.init(
				phaseOffset: Double.random(in: 0..<2 * .pi),
				amplitude: CGFloat.random(in: 6...14),
				frequency: Double.random(in: 2...4),
				speed: Double.random(in: 0.5...1.5),
				lineWidth: 1
			))
		}
		_configs = State(initialValue: tmp)
	}
	
	var body: some View {
		GeometryReader { proxy in
			let size       = proxy.size
			let baseRadius = min(size.width, size.height) * radiusRatio
			
			TimelineView(.animation) { ctx in
				let t = ctx.date.timeIntervalSinceReferenceDate
				
				ZStack {
					ForEach(configs.indices, id: \.self) { i in
						let cfg = configs[i]
						let amp = cfg.amplitude * 0.3
						let shape = WavyLoop(
							phase: t * cfg.speed * 1.25 + cfg.phaseOffset,
							amplitude: amp,
							frequency: cfg.frequency,
							radius: baseRadius
						)
						
						ZStack {
							shape
								.stroke(
									Color.black.opacity(0.10),
									style: StrokeStyle(
										lineWidth: cfg.lineWidth * 3,
										lineCap: .round,
										lineJoin: .round
									)
								)
							shape
								.stroke(
									Color("Beige"),
									style: StrokeStyle(
										lineWidth: cfg.lineWidth,
										lineCap: .round,
										lineJoin: .round
									)
								)
						}
						.frame(width: size.width, height: size.height)
						.rotationEffect(.radians(t * 0.4 * 1.25), anchor: .center)
					}
				}
				.rotation3DEffect(
					.degrees(sin(t * 0.4 * 1.25) * 15),
					axis: (x: 1, y: 0, z: 0),
					perspective: 0.6
				)
				.frame(width: size.width, height: size.height)
			}
			.frame(width: size.width, height: size.height)
		}
		.contentShape(Rectangle())
	}
}

private struct WavyLoop: Shape, Animatable {
	var phase: Double
	var amplitude: CGFloat
	var frequency: Double
	var radius: CGFloat
	
	var animatableData: Double {
		get { phase }
		set { phase = newValue }
	}
	
	func path(in rect: CGRect) -> Path {
		var path     = Path()
		let center   = CGPoint(x: rect.midX, y: rect.midY)
		let segments = 400
		
		for i in 0...segments {
			let t     = Double(i) / Double(segments)
			let angle = t * 2 * .pi
			let r     = radius + amplitude * CGFloat(sin(frequency * angle + phase))
			let x     = center.x + cos(angle) * r
			let y     = center.y + sin(angle) * r
			let pt    = CGPoint(x: x, y: y)
			
			if i == 0 { path.move(to: pt) }
			else      { path.addLine(to: pt) }
		}
		path.closeSubpath()
		return path
	}
}
