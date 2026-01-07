import SwiftUI
import UIKit

struct WavyString: View, Animatable {
	var phase: Double
	var amplitude: CGFloat
	var frequency: Double
	
	var animatableData: Double {
		get { phase }
		set { phase = newValue }
	}
	
	var body: some View {
		GeometryReader { geo in
			let midY = geo.size.height * 0.8
			let extra: CGFloat = 20
			let start = Int(-extra)
			let end = Int(geo.size.width + extra)
			let range = Double(end - start)
			
			let path = Path { p in
				for i in start...end {
					let x = CGFloat(i)
					let norm = Double(i - start) / range
					let raw = sin(.pi * norm)
					let envelope = pow(raw, 5)
					let angle = norm * frequency * 2 * .pi - phase
					let y = midY + amplitude * CGFloat(envelope) * CGFloat(sin(angle))
					
					if i == start {
						p.move(to: CGPoint(x: x, y: y))
					} else {
						p.addLine(to: CGPoint(x: x, y: y))
					}
				}
			}
			
			ZStack {
				path
					.stroke(Color.black.opacity(0.15), lineWidth: 2)
					.blur(radius: 1)
					.offset(x: 1, y: 1)
					.mask(
						Rectangle()
							.fill(
								LinearGradient(
									gradient: Gradient(stops: [
										.init(color: .black.opacity(0), location: 0),
										.init(color: .black.opacity(1), location: 0.2),
										.init(color: .black.opacity(1), location: 0.8),
										.init(color: .black.opacity(0), location: 1)
									]),
									startPoint: .leading,
									endPoint: .trailing
								)
							)
					)
				
				path
					.stroke(
						LinearGradient(
							gradient: Gradient(colors: [
								Color("Beige").opacity(0.7),
								Color("Beige")
							]),
							startPoint: .top,
							endPoint: .bottom
						),
						lineWidth: 1
					)
			}
		}
	}
}

struct StringView: View {
	private struct WaveConfig {
		let amplitude: CGFloat
		let frequency: Double
		let duration: Double
	}
	
	// ─────────── Section Header ───────────
	private let slowFactor: Double = 1.3
	private let configs: [WaveConfig]
	private let revealDurations: [Double]
	
	@State private var phases: [Double]
	@State private var tilt: Double = 0
	@State private var revealProgresses: [CGFloat]
	@State private var prevLevel: CGFloat = 0
	
	// ─────────── Section Header ───────────
	@Binding private var level: CGFloat
	
	private let minMul: CGFloat = 0.1
	private let maxMul: CGFloat = 1.0
	private let shapeGamma: Double = 1.0
	private let gate: CGFloat = 0.06
	private let volatilityBoost: CGFloat = 0.35
	
	init(level: Binding<CGFloat> = .constant(0), stringCount: Int = 6) {
		var tmp = [WaveConfig]()
		for _ in 0..<stringCount {
			tmp.append(.init(
				amplitude: CGFloat.random(in: 20...40),
				frequency: Double.random(in: 0.8...2.0),
				duration: Double.random(in: 1.0...2.0)
			))
		}
		configs = tmp
		_phases = State(initialValue: Array(repeating: 0, count: tmp.count))
		_revealProgresses = State(initialValue: Array(repeating: 0, count: tmp.count))
		revealDurations = tmp.map { _ in Double.random(in: 0.5...1.5) }
		_level = level
	}
	
	var body: some View {
		GeometryReader { geo in
			ZStack {
				ForEach(configs.indices, id: \.self) { i in
					let baseAmp = configs[i].amplitude
					let cycle = configs[i].duration * slowFactor
					
					let gated = max(0, level - gate) / max(0.001, 1 - gate)
					let delta = abs(level - prevLevel)
					let boosted = min(1, gated * (1 + volatilityBoost * delta * 4))
					let easedOut = 1 - pow(1 - Double(min(1, boosted)), shapeGamma)
					let mul = minMul + (maxMul - minMul) * CGFloat(easedOut)
					let amp = baseAmp * mul
					
					WavyString(
						phase: phases[i],
						amplitude: amp,
						frequency: configs[i].frequency
					)
					.frame(width: geo.size.width, height: geo.size.height)
					.onAppear {
						withAnimation(.linear(duration: cycle).repeatForever(autoreverses: false)) {
							phases[i] = 2 * .pi
						}
					}
					.mask(
						Rectangle()
							.padding(.trailing, geo.size.width * (1 - revealProgresses[i]))
					)
				}
			}
			.frame(width: geo.size.width, height: geo.size.height)
			.rotation3DEffect(.degrees(tilt), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
			.onAppear {
				prevLevel = level
				withAnimation(.easeInOut(duration: 4 * slowFactor).repeatForever(autoreverses: true)) {
					tilt = 15
				}
				for i in configs.indices {
					withAnimation(.easeOut(duration: revealDurations[i])) {
						revealProgresses[i] = 1
					}
				}
			}
			.onChange(of: level) { newValue in
				prevLevel = newValue
			}
		}
	}
}
