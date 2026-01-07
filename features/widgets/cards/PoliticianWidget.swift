import SwiftUI
import SDWebImageSwiftUI
import Charts

struct PoliticianWidget: View {
	let metadata: PoliticianMetadata?
	let cardId: String?
	let height: CGFloat?
	let style: PoliticianPreview.Style
	
	init(
		metadata: PoliticianMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil,
		style: PoliticianPreview.Style = .bar
	) {
		self.metadata = metadata
		self.cardId   = cardId
		self.height   = height
		self.style    = style
	}
	
	var body: some View {
		Group {
			if let meta = metadata {
				if let series = meta.pollSeries, !series.isEmpty {
					let preview = PoliticianPollPreview(
						name: meta.name ?? "",
						points: series,
						style: (style == .bubble ? .bubble : .bar),
						height: height
					)
						.frame(maxWidth: .infinity)
					
					Group {
						if let h = height { preview.frame(height: h) } else { preview }
					}
					.id(cardId)
					.overlay(InteractiveFrameReader())
					
				} else {
					basicContent(meta)
						.id(cardId)
						.overlay(InteractiveFrameReader())
				}
			} else {
				EmptyView()
			}
		}
	}
	
	private func basicContent(_ pol: PoliticianMetadata) -> some View {
		let subtitle = [pol.locale, pol.party]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
			.joined(separator: " • ")
			.capitalized
		
		return PoliticianPreview(
			name: pol.name ?? "",
			subtitle: subtitle,
			headshot: pol.imageURL.flatMap(URL.init),
			externalURL: pol.officialURL.flatMap(URL.init),
			style: style,
			height: height
		)
		.frame(maxWidth: .infinity)
	}
}

struct PoliticianPreview: View {
	enum Style { case bubble, bar }
	
	let name       : String
	let subtitle   : String
	let headshot   : URL?
	let externalURL: URL?
	let style      : Style
	let height     : CGFloat?
	
	@Environment(\.openURL) private var openURL
	@State private var isTapAnimating = false
	@State private var haptic: UIImpactFeedbackGenerator?
	
	init(
		name: String,
		subtitle: String,
		headshot: URL?,
		externalURL: URL?,
		style: Style,
		height: CGFloat? = nil
	) {
		self.name        = name
		self.subtitle    = subtitle
		self.headshot    = headshot
		self.externalURL = externalURL
		self.style       = style
		self.height      = height
	}
	
	private static let bubbleHeight: CGFloat = 200
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		GeometryReader { geo in
			let C      = constants(for: geo.size.height)
			let radius : CGFloat = 20
			let shape  : AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: radius))
			: AnyShape(RoundedCorner(radius: radius, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				WebImage(url: headshot)
					.resizable()
					.scaledToFill()
					.frame(width: C.thumbW, height: C.thumbH)
					.clipShape(RoundedRectangle(cornerRadius: 20))
				
				VStack(alignment: .leading, spacing: 2) {
					Text(name)
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(2)
					Text(subtitle)
						.font(.subheadline)
						.foregroundColor(.white.opacity(0.85))
						.lineLimit(2)
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background {
				if let url = headshot {
					ArtworkWave(url: url, shape: shape)
				} else {
					shape.fill(Color.accentColor.opacity(0.35))
				}
			}
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight)
		.transaction { $0.disablesAnimations = true }
	}
	
	private func constants(for h: CGFloat)
	-> (thumbW: CGFloat, thumbH: CGFloat, pad: CGFloat, icon: CGFloat) {
		switch style {
		case .bubble:
			let pad: CGFloat = 20
			let thumbH       = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, 22)
		case .bar:
			let pad: CGFloat = 20
			let thumbH       = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, max(h * 0.12, 18))
		}
	}
}

struct PoliticianPollPreview: View {
	enum Style { case bubble, bar }
	
	let name  : String
	let style : Style
	let height: CGFloat?
	private let plots: [Plot]
	
	@Environment(\.colorScheme) private var scheme
	
	private struct Plot: Identifiable {
		let id = UUID()
		let date: Date
		let pct: Double
	}
	
	private static let isoFormatter: ISO8601DateFormatter = {
		let f = ISO8601DateFormatter()
		return f
	}()
	
	init(
		name: String,
		points: [PoliticianMetadata.PollPoint],
		style: Style,
		height: CGFloat?
	) {
		self.name   = name.capitalized
		self.style  = style
		self.height = height
		
		let raw: [Plot] = points.compactMap { p in
			guard let ds = p.date,
				  let d  = Self.isoFormatter.date(from: ds + "T00:00:00Z"),
				  let pct = p.pct else { return nil }
			return Plot(date: d, pct: pct)
		}
			.sorted { $0.date < $1.date }
		
		let cal = Calendar.current
		var daily: [Date: [Plot]] = [:]
		for p in raw {
			daily[cal.startOfDay(for: p.date), default: []].append(p)
		}
		let binned: [Plot] = daily.map { (day, arr) in
			let avg = arr.map(\.pct).reduce(0, +) / Double(arr.count)
			return Plot(date: day, pct: avg)
		}
			.sorted { $0.date < $1.date }
		
		let cutoff = cal.date(byAdding: .day, value: -30, to: Date())!
		let recent = binned.filter { $0.date >= cutoff }
		self.plots = recent.isEmpty ? binned : recent
	}
	
	private var latest: Double { plots.last?.pct ?? 0 }
	
	private var yRange: ClosedRange<Double> {
		let values = plots.map(\.pct)
		guard let lo = values.min(), let hi = values.max() else { return 0...1 }
		let pad  = (hi - lo) * 0.01
		return max(0, lo - pad) ... min(100, hi + pad)
	}
	
	private var dateRangeLabel: String? {
		guard let first = plots.first?.date,
			  let last  = plots.last?.date else { return nil }
		let fmt = DateFormatter(); fmt.dateFormat = "MMM dd"
		return "\(fmt.string(from: first).uppercased()) – \(fmt.string(from: last).uppercased())"
	}
	
	private var changeColor: Color {
		guard plots.count > 1,
			  let a = plots.first?.pct,
			  let b = plots.last?.pct else { return .blue }
		return b >= a ? .blue : .red
	}
	
	var body: some View {
		GeometryReader { geo in
			let shape: AnyShape = (style == .bubble)
			? AnyShape(RoundedRectangle(cornerRadius: 20))
			: AnyShape(RoundedCorner(radius: 20, corners: [.topLeft, .topRight]))
			
			ZStack {
				shape
					.fill(.thinMaterial)
					.clipShape(shape)
					.overlay(shape.stroke(Color.primary.opacity(0.15), lineWidth: 0.5))
				
				VStack(spacing: 6) {
					HStack {
						Text(name)
							.font(.headline)
							.foregroundColor(.primary)
						Spacer()
						Text(String(format: "%.0f%%", latest))
							.font(.subheadline)
							.foregroundColor(changeColor)
					}
					
					Chart {
						ForEach(plots) { p in
							LineMark(
								x: .value("Date", p.date),
								y: .value("Pct",  p.pct)
							)
							.interpolationMethod(.catmullRom)
							.foregroundStyle(changeColor)
						}
					}
					.chartYScale(domain: yRange)
					.chartXAxis(.hidden)
					.chartYAxis {
						AxisMarks(position: .trailing,
								  values: [yRange.lowerBound, yRange.upperBound]) { v in
							AxisGridLine(centered: true, stroke: StrokeStyle(lineWidth: 0.5))
								.foregroundStyle(Color.primary.opacity(scheme == .dark ? 0.30 : 0.20))
							AxisValueLabel {
								if let num = v.as(Double.self) {
									Text(String(format: "%.0f%%", num))
										.font(.caption)
										.foregroundColor(Color.primary.opacity(scheme == .dark ? 0.85 : 0.65))
								}
							}
						}
					}
					.padding(.horizontal, 4)
					.frame(maxHeight: .infinity)
					
					HStack {
						if let range = dateRangeLabel {
							Text(range)
								.font(.caption2)
								.foregroundColor(.primary.opacity(0.7))
						}
						Spacer()
					}
				}
				.padding(20)
			}
			.frame(width: geo.size.width, height: geo.size.height)
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: height)
		.transaction { $0.disablesAnimations = true }
	}
}
