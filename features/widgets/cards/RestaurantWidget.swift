import SwiftUI
import SDWebImageSwiftUI

struct RestaurantWidget: View {
	let metadata: RestaurantMetadata?
	let cardId  : String?
	let height  : CGFloat?
	
	init(
		metadata: RestaurantMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil
	) {
		self.metadata = metadata
		self.cardId   = cardId
		self.height   = height
	}
	
	var body: some View {
		if let r = metadata {
			content(for: r)
				.id(cardId)
				.overlay(InteractiveFrameReader())
		}
	}
	
	@ViewBuilder
	private func content(for r: RestaurantMetadata) -> some View {
		let preview = RestaurantPreview(restaurant: r, style: .bar, height: height)
			.frame(maxWidth: .infinity)
		
		if let h = height {
			preview.frame(height: h)
		} else {
			preview
		}
	}
}

struct RoundedCorner: Shape {
	var radius: CGFloat = 6
	var corners: UIRectCorner = .allCorners
	func path(in rect: CGRect) -> Path {
		let p = UIBezierPath(
			roundedRect: rect,
			byRoundingCorners: corners,
			cornerRadii: CGSize(width: radius, height: radius)
		)
		return Path(p.cgPath)
	}
}

struct YelpStarRatingView: View {
	let rating: Double
	private let fillColor = Color("Beige")
	
	var body: some View {
		HStack(spacing: 2) {
			ForEach(0..<5) { idx in
				StarView(fillFraction: max(min(rating - Double(idx), 1), 0),
						 color: fillColor)
				.frame(width: 15, height: 15)
			}
			Text(String(format: "%.1f", rating))
				.font(.footnote)
				.foregroundColor(.primary.opacity(0.9))
				.padding(.leading, 4)
		}
	}
}

private struct StarView: View {
	let fillFraction: Double
	let color: Color
	var body: some View {
		ZStack {
			Image(systemName: "star")
				.resizable()
				.aspectRatio(1, contentMode: .fit)
				.foregroundColor(color)
			Image(systemName: "star.fill")
				.resizable()
				.aspectRatio(1, contentMode: .fit)
				.foregroundColor(color)
				.mask(
					Rectangle()
						.scale(x: CGFloat(fillFraction), y: 1, anchor: .leading)
				)
		}
	}
}

struct RestaurantPreview: View {
	enum Style { case bubble, bar }
	
	let restaurant: RestaurantMetadata
	let style     : Style
	let height    : CGFloat?
	
	private static let bubbleHeight: CGFloat = 200
	
	init(restaurant: RestaurantMetadata,
		 style: Style,
		 height: CGFloat? = nil) {
		self.restaurant = restaurant
		self.style      = style
		self.height     = height
	}
	
	private var cuisineText: String {
		restaurant.categories?.joined(separator: ", ") ?? ""
	}
	private var ratingText: String {
		if let r = restaurant.ratingYelp ?? restaurant.ratingGoogle {
			return String(format: "%.1f ★", r)
		}
		return ""
	}
	private var photoURL: URL? {
		restaurant.photos?.first.flatMap { URL(string: $0) }
	}
	private var yelpURL: URL? {
		if let urlStr = restaurant.yelpUrl { return URL(string: urlStr) }
		return nil
	}
	
	@Environment(\.openURL) private var openURL
	@State private var isTapAnimating = false
	@State private var haptic: UIImpactFeedbackGenerator?
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		GeometryReader { geo in
			let C = constants(for: geo.size.height)
			let shape: AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: 20))
			: AnyShape(RoundedCorner(radius: 20, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				WebImage(url: photoURL)
					.resizable()
					.scaledToFill()
					.frame(width: C.img, height: C.img)
					.clipShape(RoundedRectangle(cornerRadius: 20))
					.scaleEffect(isTapAnimating ? 0.965 : 1.0)
					.contentShape(Rectangle())
					.gesture(
						DragGesture(minimumDistance: 0)
							.onChanged { _ in
								guard yelpURL != nil else { return }
								if !isTapAnimating {
									haptic = UIImpactFeedbackGenerator(style: .light)
									haptic?.prepare()
									withAnimation(.spring(response: 0.18, dampingFraction: 0.7)) {
										isTapAnimating = true
									}
								}
							}
							.onEnded { _ in
								guard let url = yelpURL else {
									withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) {
										isTapAnimating = false
									}
									return
								}
								haptic?.impactOccurred(intensity: 0.7)
								withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) {
									isTapAnimating = false
								}
								DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) {
									openURL(url)
								}
							}
					)
					.accessibilityAddTraits(yelpURL != nil ? .isButton : [])
				
				VStack(alignment: .leading, spacing: 2) {
					Text(restaurant.name ?? "Unknown Restaurant")
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(2)
					
					if !cuisineText.isEmpty {
						Text(cuisineText)
							.font(.subheadline)
							.foregroundColor(.white.opacity(0.85))
							.lineLimit(2)
					}
					
					if !ratingText.isEmpty {
						Text(ratingText)
							.font(.footnote.weight(.semibold))
							.foregroundColor(.white.opacity(0.9))
					}
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background { ArtworkWave(url: photoURL, shape: shape) }
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 3)
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight)
		.transaction { $0.disablesAnimations = true }
	}
	
	private func constants(for h: CGFloat)
	-> (img: CGFloat, pad: CGFloat, icon: CGFloat) {
		let pad: CGFloat = 20
		switch style {
		case .bubble:
			let img = max(0, h - pad * 2)
			return (img, pad, 26)
		case .bar:
			let img = max(0, h - pad * 2)
			return (img, pad, max(h * 0.12, 18))
		}
	}
}
