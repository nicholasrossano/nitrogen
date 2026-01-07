// BookWidget.swift
import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics

struct BookWidget: View {
	let metadata: BookMetadata?
	let cardId  : String?
	let height  : CGFloat?
	
	init(
		metadata: BookMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil
	) {
		self.metadata = metadata
		self.cardId   = cardId
		self.height   = height
	}
	
	var body: some View {
		if let book = metadata,
		   let cover = book.cover,
		   !cover.isEmpty,
		   cover != "N/A" {
			content(for: book)
				.id(cardId)
				.overlay(InteractiveFrameReader())
		}
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func content(for book: BookMetadata) -> some View {
		let preview = BookPreview(book: book, style: .bar, height: height, cardId: cardId)
			.frame(maxWidth: .infinity)
		
		if let h = height {
			preview
				.frame(height: h)
				.overlay(alignment: .bottomTrailing) {
					OpenInPillBook(cardId: cardId, book: book)
						.padding(.trailing, 20)
						.padding(.bottom, 20)
				}
		} else {
			preview
				.overlay(alignment: .bottomTrailing) {
					OpenInPillBook(cardId: cardId, book: book)
						.padding(.trailing, 20)
						.padding(.bottom, 20)
				}
		}
	}
}

struct BookPreview: View {
	enum Style { case bubble, bar }
	
	let book  : BookMetadata
	let style : Style
	let height: CGFloat?
	let cardId: String?
	
	private static let bubbleHeight: CGFloat = 200
	
	@State private var coverCandidates: [URL] = []
	@State private var coverCandidateIndex = 0
	@State private var coverURL: URL?
	
	init(book: BookMetadata, style: Style, height: CGFloat? = nil, cardId: String? = nil) {
		self.book   = book
		self.style  = style
		self.height = height
		self.cardId = cardId
	}
	
	private var ratingText: String {
		guard let r = book.averageRating else { return "" }
		if let c = book.ratingsCount, c > 0 {
			return String(format: "%.1f ★ (%d)", r, c)
		}
		return String(format: "%.1f ★", r)
	}
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		GeometryReader { geo in
			let C = constants(for: geo.size.height)
			let thumbnailSize = CGSize(
				width: C.coverW * UIScreen.main.scale,
				height: C.coverH * UIScreen.main.scale
			)
			let shape: AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: 20))
			: AnyShape(RoundedCorner(radius: 20, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				WebImage(
					url: coverURL,
					options: [.scaleDownLargeImages],
					context: [.imageThumbnailPixelSize: thumbnailSize]
				)
				.onFailure { _ in
					book.recordCoverFailure(coverURL)
					advanceCoverCandidate()
				}
				.resizable()
				.scaledToFill()
				.frame(width: C.coverW, height: C.coverH)
				.clipShape(RoundedRectangle(cornerRadius: 20))
				.contentShape(Rectangle())
				.allowsHitTesting(false)
				.onAppear {
					Analytics.logEvent("book_cover_request", parameters: [
						"card_id": (cardId ?? "") as NSString,
						"topic_id": inferredTopicId as NSString,
						"screen": "book_widget" as NSString,
						"trigger": "render" as NSString
					])
				}
				
				VStack(alignment: .leading, spacing: 2) {
					Text(book.title ?? "Unknown Title")
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(2)
					
					Text((book.authors ?? []).joined(separator: ", "))
						.font(.subheadline)
						.foregroundColor(.white.opacity(0.85))
						.lineLimit(2)
					
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
			.background { ArtworkWave(url: coverURL, shape: shape) }
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 3)
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight)
		.transaction { $0.disablesAnimations = true }
		.onAppear(perform: resetCoverCandidates)
		.onChange(of: book.cover) { _ in resetCoverCandidates() }
	}
	
	private func constants(for h: CGFloat)
	-> (coverW: CGFloat, coverH: CGFloat, pad: CGFloat, icon: CGFloat) {
		switch style {
		case .bubble:
			let pad: CGFloat = 20
			let coverH = max(0, h - pad * 2)
			return (coverH * 2 / 3, coverH, pad, 26)
		case .bar:
			let pad: CGFloat = 20
			let coverH = max(0, h - pad * 2)
			return (coverH * 2 / 3, coverH, pad, max(h * 0.12, 18))
		}
	}
	
	private var inferredTopicId: String {
		let lowers = (book.categories ?? []).map { $0.lowercased() }
		if lowers.contains(where: { $0.contains("cook") || $0.contains("food") || $0.contains("drink") }) {
			return "13"
		}
		return "10"
	}
	
	private func resetCoverCandidates() {
		let candidates = book.coverURLCandidates()
		coverCandidates = candidates
		coverCandidateIndex = 0
		coverURL = candidates.first
	}
	
	private func advanceCoverCandidate() {
		let nextIndex = coverCandidateIndex + 1
		guard nextIndex < coverCandidates.count else { return }
		coverCandidateIndex = nextIndex
		coverURL = coverCandidates[nextIndex]
	}
}
