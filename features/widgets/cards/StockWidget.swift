import SwiftUI
import Charts
import FirebaseAnalytics

struct StockWidget: View {
	let metadata: StockMetadata?
	let cardId: String?
	let height: CGFloat?
	let companyStyle: TeamPreview.Style
	
	init(
		metadata: StockMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil,
		companyStyle: TeamPreview.Style = .bar
	) {
		self.metadata      = metadata
		self.cardId        = cardId
		self.height        = height
		self.companyStyle  = companyStyle
	}
	
	var body: some View {
		Group {
			if let meta = metadata {
				if let pts = meta.dataPoints, !pts.isEmpty {
					let preview = StockPreview(metadata: meta, style: .bar)
						.frame(maxWidth: .infinity)
						.onAppear {
							Analytics.logEvent(
								"stock_widget_render",
								parameters: [
									"variant": "chart" as NSString,
									"ticker": (meta.ticker ?? "") as NSString,
									"card_id": (cardId ?? "") as NSString
								]
							)
						}
					
					Group {
						if let h = height { preview.frame(height: h) } else { preview }
					}
					.id(cardId)
					.overlay(InteractiveFrameReader())
					
				} else {
					let displayName = (meta.companyName?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
					?? (meta.ticker?.uppercased() ?? "")
					let subtitle = meta.companyIndustry?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
					let logoURL = meta.companyLogoURL.flatMap(URL.init)
					let external = (meta.stocksLink ?? meta.companyURL).flatMap(URL.init)   // ← stocks page first
					
					let fallback = TeamPreview(
						name: displayName,
						subtitle: subtitle,
						logo: logoURL,
						externalURL: external,
						ranking: nil,
						record: nil,
						style: companyStyle,
						height: height
					)
						.frame(maxWidth: .infinity)
						.onAppear {
							Analytics.logEvent(
								"stock_widget_render",
								parameters: [
									"variant": "company" as NSString,
									"ticker": (meta.ticker ?? "") as NSString,
									"company_name": displayName as NSString,
									"has_logo": NSNumber(value: logoURL != nil),
									"card_id": (cardId ?? "") as NSString
								]
							)
						}
					
					Group {
						if let h = height { fallback.frame(height: h) } else { fallback }
					}
					.id(cardId)
					.overlay(InteractiveFrameReader())
				}
			} else {
				EmptyView()
			}
		}
	}
}

struct StockPreview: View {
	enum Style { case bubble, bar }
	
	let metadata: StockMetadata
	let style   : Style
	let height  : CGFloat?
	
	@Environment(\.colorScheme) private var scheme
	
	private static let bubbleHeight: CGFloat = 200
	private let chartPaddingRatio: CGFloat = 0.01
	
	init(metadata: StockMetadata,
		 style: Style,
		 height: CGFloat? = nil) {
		self.metadata = metadata
		self.style    = style
		self.height   = height
	}
	
	private var points: [StockMetadata.DataPoint] {
		metadata.dataPoints?.filter { !$0.close.isNaN } ?? []
	}
	private var pctChange: Double? {
		guard let first = points.first,
			  let last  = points.last,
			  first.close != 0
		else { return nil }
		return (last.close - first.close) / first.close * 100
	}
	private var changeColor: Color {
		pctChange.map { $0 >= 0 ? .green : .red } ?? .primary
	}
	private var yRange: ClosedRange<Double> {
		guard !points.isEmpty else { return 0...1 }
		let closes = points.map(\.close)
		let pad = (closes.max()! - closes.min()!) * chartPaddingRatio
		let low  = closes.min()! - pad
		let high = max(low + 0.01, closes.max()! + pad)
		return low...high
	}
	
	private func parseDate(_ value: Any) -> Date? {
		if let d = value as? Date { return d }
		if let s = value as? String {
			if let iso = ISO8601DateFormatter().date(from: s) { return iso }
			let f = DateFormatter()
			f.locale = Locale(identifier: "en_US_POSIX")
			f.timeZone = TimeZone(secondsFromGMT: 0)
			f.dateFormat = "yyyy-MM-dd"
			return f.date(from: s)
		}
		return nil
	}
	
	private var dateRangeLabel: String {
		guard
			let firstRaw = points.first?.date,
			let lastRaw  = points.last?.date,
			let first    = parseDate(firstRaw),
			let last     = parseDate(lastRaw)
		else { return "" }
		
		let cal = Calendar.current
		let monthFmt = DateFormatter()
		monthFmt.locale = .init(identifier: "en_US_POSIX")
		monthFmt.dateFormat = "MMM"
		let dayFmt = DateFormatter()
		dayFmt.locale = monthFmt.locale
		dayFmt.dateFormat = "d"
		let yearFmt = DateFormatter()
		yearFmt.locale = monthFmt.locale
		yearFmt.dateFormat = "yyyy"
		
		let m1 = monthFmt.string(from: first)
		let m2 = monthFmt.string(from: last)
		let d1 = dayFmt.string(from: first)
		let d2 = dayFmt.string(from: last)
		let dash = "\u{2013}"
		
		if cal.isDate(first, equalTo: last, toGranularity: .year) {
			if cal.isDate(first, equalTo: last, toGranularity: .month) {
				return "\(m1) \(d1)\(dash)\(d2)"
			} else {
				return "\(m1) \(d1)\(dash)\(m2) \(d2)"
			}
		}
		let y1 = yearFmt.string(from: first)
		let y2 = yearFmt.string(from: last)
		return "\(m1) \(d1) \(y1)\(dash)\(m2) \(d2) \(y2)"
	}
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		Group {
			if points.isEmpty {
				let displayName = (metadata.companyName?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
				?? (metadata.ticker?.uppercased() ?? "")
				let subtitle = metadata.companyIndustry?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
				let logoURL = metadata.companyLogoURL.flatMap(URL.init)
				let external = (metadata.stocksLink ?? metadata.companyURL).flatMap(URL.init)   // ← stocks page first
				
				TeamPreview(
					name: displayName,
					subtitle: subtitle,
					logo: logoURL,
					externalURL: external,
					ranking: nil,
					record: nil,
					style: (style == .bubble ? .bubble : .bar),
					height: fixedHeight
				)
				.frame(maxWidth: .infinity)
				.onAppear {
					Analytics.logEvent(
						"stock_widget_render",
						parameters: [
							"variant": "company" as NSString,
							"ticker": (metadata.ticker ?? "") as NSString,
							"company_name": displayName as NSString,
							"has_logo": NSNumber(value: logoURL != nil),
							"screen": "curator" as NSString
						]
					)
				}
				.overlay(InteractiveFrameReader().allowsHitTesting(false))
				.transaction { $0.disablesAnimations = true }
				
			} else {
				GeometryReader { geo in
					let shape: AnyShape = style == .bubble
					? AnyShape(RoundedRectangle(cornerRadius: 20))
					: AnyShape(RoundedCorner(radius: 20, corners: [.topLeft, .topRight]))
					
					ZStack {
						shape
							.fill(.thinMaterial)
							.clipShape(shape)
							.overlay(shape.stroke(Color.primary.opacity(0.15), lineWidth: 0.5))
						
						VStack(spacing: 4) {
							HStack {
								Text(metadata.ticker?.uppercased() ?? "")
									.font(.headline)
									.foregroundColor(.primary)
								Spacer()
							}
							
							Chart {
								ForEach(points, id: \.date) { p in
									LineMark(x: .value("Date", p.date),
											 y: .value("Close", p.close))
									.interpolationMethod(.catmullRom)
									.foregroundStyle(changeColor)
								}
							}
							.chartYScale(domain: yRange)
							.chartXAxis(.hidden)
							.chartYAxis {
								AxisMarks(position: .trailing,
										  values: [yRange.lowerBound, yRange.upperBound]) { v in
									AxisGridLine(centered: true,
												 stroke: StrokeStyle(lineWidth: 0.5))
									.foregroundStyle(Color.primary.opacity(scheme == .dark ? 0.30 : 0.20))
									AxisValueLabel {
										if let num = v.as(Double.self) {
											Text(String(format: "%.2f", num))
												.font(.caption)
												.foregroundColor(Color.primary.opacity(scheme == .dark ? 0.85 : 0.65))
										}
									}
								}
							}
							.padding(.horizontal, 4)
							
							HStack {
								Text(dateRangeLabel.uppercased())
									.font(.caption2)
								Spacer()
								if let pct = pctChange {
									Text(String(format: "%.2f%%", pct))
										.font(.subheadline)
										.foregroundColor(changeColor)
								}
							}
						}
						.padding(20)
					}
					.frame(width: geo.size.width, height: geo.size.height)
					.onAppear {
						Analytics.logEvent(
							"stock_widget_render",
							parameters: [
								"variant": "chart" as NSString,
								"ticker": (metadata.ticker ?? "") as NSString,
								"screen": "curator" as NSString
							]
						)
					}
					.overlay(InteractiveFrameReader().allowsHitTesting(false))
				}
				.frame(height: fixedHeight)
				.transaction { $0.disablesAnimations = true }
			}
		}
	}
}
