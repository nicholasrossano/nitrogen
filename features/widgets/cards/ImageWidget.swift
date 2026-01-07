import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics
import UIKit
import FirebaseFirestore

struct ImageWidget: View {
	struct HeroImage {
		let imageURL: URL
		let sourceName: String?
		let sourceURL: URL?
	}
	
	let card: Card
	let height: CGFloat?
	
	@State private var isPressing = false
	@State private var showSafari = false
	@State private var localHeroImageIndex: Int? = nil
	@State private var isCyclingHeroImage = false
	
	@ObservedObject private var flags = FeatureFlagsManager.shared
	
	// ─────────── Section Header ───────────
	static func heroImage(for card: Card?, overrideIndex: Int? = nil) -> HeroImage? {
		guard let images = card?.enrichedMetadata?.articleImages,
			  !images.isEmpty else { return nil }
		
		func looksLogoLike(_ s: String) -> Bool {
			let lower = s.lowercased()
			let tokens = [
				"logo",
				"favicon",
				"sprite",
				"default",
				"placeholder",
				"icon",
				"badge",
				"avatar",
				"profile",
				"twc_default",
				"placeholder-video-thumbnail"
			]
			return tokens.contains(where: { lower.contains($0) })
		}
		
		func isNYTimesHost(_ host: String) -> Bool {
			let h = host.lowercased()
			return h.contains("nytimes.com") || h.contains("nyt.com")
		}
		
		func isBadHost(_ urlStr: String?) -> Bool {
			guard let s = urlStr?.trimmingCharacters(in: .whitespacesAndNewlines),
				  !s.isEmpty,
				  let u = URL(string: s) else { return false }
			let host = (u.host ?? "").lowercased()
			if isNYTimesHost(host) { return true }
			if host.contains("logo.dev") || host.contains("logo.clearbit") { return true }
			return false
		}
		
		func isViable(_ img: ArticleImage) -> Bool {
			let rawImage = img.imageUrl ?? img.sourceUrl
			guard let raw = rawImage?.trimmingCharacters(in: .whitespacesAndNewlines),
				  !raw.isEmpty else { return false }
			
			if looksLogoLike(raw) { return false }
			if isBadHost(img.imageUrl) { return false }
			if isBadHost(img.sourceUrl) { return false }
			
			if let nameLower = img.sourceName?.lowercased(),
			   nameLower.contains("new york times") { return false }
			
			if let w = img.width, let h = img.height,
			   (w < 200 || h < 200) {
				return false
			}
			
			return true
		}
		
		func isLandscape(_ img: ArticleImage) -> Bool {
			if let w = img.width, let h = img.height, w > 0, h > 0 {
				return Double(w) / Double(h) >= 1.1
			}
			return true
		}
		
		let filtered = images.filter { isViable($0) }
		guard !filtered.isEmpty else { return nil }
		
		let landscape = filtered.filter { isLandscape($0) }
		let baseList = landscape.isEmpty ? filtered : landscape
		
		guard !baseList.isEmpty else { return nil }
		
		let rawIndex = overrideIndex ?? card?.enrichedMetadata?.heroImageIndex ?? 0
		let idx: Int = {
			if baseList.count == 1 { return 0 }
			if rawIndex <= 0 { return 0 }
			return rawIndex % baseList.count
		}()
		
		let candidate = baseList[idx]
		
		let rawURLStr = candidate.imageUrl ?? candidate.sourceUrl
		guard let raw = rawURLStr?.trimmingCharacters(in: .whitespacesAndNewlines),
			  !raw.isEmpty else { return nil }
		
		let secure = raw.hasPrefix("http://")
		? raw.replacingOccurrences(of: "http://", with: "https://")
		: raw
		
		guard let imageURL = URL(string: secure) else { return nil }
		
		let cleanName = candidate.sourceName?.trimmingCharacters(in: .whitespacesAndNewlines)
		var sourceURL: URL? = nil
		if let s = candidate.sourceUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !s.isEmpty {
			let srcSecure = s.hasPrefix("http://")
			? s.replacingOccurrences(of: "http://", with: "https://")
			: s
			sourceURL = URL(string: srcSecure)
		}
		
		return HeroImage(
			imageURL: imageURL,
			sourceName: (cleanName?.isEmpty == false ? cleanName : nil),
			sourceURL: sourceURL
		)
	}
	
	// ─────────── Section Header ───────────
	var body: some View {
		if let hero = ImageWidget.heroImage(for: card, overrideIndex: localHeroImageIndex) {
			GeometryReader { geo in
				ZStack(alignment: .bottomLeading) {
					WebImage(url: hero.imageURL)
						.resizable()
						.scaledToFill()
						.frame(width: geo.size.width, height: geo.size.height)
						.clipped()
						.contentShape(Rectangle())
					
					if let label = hero.sourceName,
					   let url = hero.sourceURL {
						Button {
							UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
							let domain = url.host ?? ""
							var params: [String: Any] = [
								"screen": "curator" as NSString,
								"source_name": label as NSString,
								"domain": domain as NSString
							]
							params["card_id"] = card.id as NSString
							Analytics.logEvent("image_widget_source_tap", parameters: params)
							showSafari = true
						} label: {
							Text(label)
								.font(.caption.weight(.semibold))
								.foregroundColor(.white)
								.padding(.horizontal, 12)
								.padding(.vertical, 7)
								.scaleEffect(isPressing ? 0.96 : 1.0)
								.contentShape(Capsule())
						}
						.buttonStyle(.plain)
						.background(
							Capsule(style: .continuous)
								.fill(.ultraThinMaterial)
								.overlay(
									Capsule(style: .continuous)
										.stroke(Color.white.opacity(0.6), lineWidth: 0.5)
								)
								.shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 3)
						)
						.fixedSize(horizontal: true, vertical: true)
						.padding(.leading, 16)
						.padding(.bottom, 12)
						.simultaneousGesture(
							DragGesture(minimumDistance: 0)
								.onChanged { _ in if !isPressing { isPressing = true } }
								.onEnded { _ in isPressing = false }
						)
					}
				}
				.overlay(alignment: .bottomTrailing) {
					adminCycleButton
				}
			}
			.frame(height: height)
			.id(card.id)
			.overlay(InteractiveFrameReader())
			.transaction { $0.disablesAnimations = true }
			.sheet(isPresented: $showSafari) {
				if let hero = ImageWidget.heroImage(for: card, overrideIndex: localHeroImageIndex),
				   let url = hero.sourceURL {
					SafariView(url: url, entersReaderIfAvailable: false)
				}
			}
		} else {
			EmptyView()
		}
	}
	
	// ─────────── Section Header ───────────
	private var adminCycleButton: some View {
		Group {
			if flags.currentUserRole == "admin",
			   (card.enrichedMetadata?.articleImages?.count ?? 0) > 1 {
				Button {
					UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
					cycleHeroImage()
				} label: {
					Image(systemName: "arrow.triangle.2.circlepath")
						.font(.system(size: 14, weight: .semibold))
						.foregroundColor(.white)
						.frame(width: 32, height: 32)
						.background(
							Circle()
								.fill(.ultraThinMaterial)
								.overlay(
									Circle()
										.stroke(Color.white.opacity(0.6), lineWidth: 0.5)
								)
								.shadow(color: .black.opacity(0.18), radius: 8, x: 0, y: 3)
						)
				}
				.buttonStyle(.plain)
				.padding(.trailing, 10)
				.padding(.bottom, 10)
				.disabled(isCyclingHeroImage)
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func cycleHeroImage() {
		guard !isCyclingHeroImage else { return }
		guard card.enrichedMetadata?.articleImages?.isEmpty == false else { return }
		
		isCyclingHeroImage = true
		
		UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
		
		let currentIndex = localHeroImageIndex ?? card.enrichedMetadata?.heroImageIndex ?? 0
		let nextIndex = currentIndex + 1
		
		var params: [String: Any] = [
			"screen": "curator" as NSString,
			"new_index": NSNumber(value: nextIndex)
		]
		params["card_id"] = card.id as NSString
		if let topic = card.topic {
			params["topic_id"] = topic as NSString
		}
		Analytics.logEvent("hero_image_cycle_tap", parameters: params)
		
		let db = Firestore.firestore()
		db.collection("cards").document(card.id).updateData([
			"enrichedMetadata.heroImageIndex": nextIndex
		]) { error in
			DispatchQueue.main.async {
				if let error {
					print("Failed to update heroImageIndex for card \(card.id): \(error.localizedDescription)")
				} else {
					self.localHeroImageIndex = nextIndex
				}
				self.isCyclingHeroImage = false
			}
		}
	}
}
