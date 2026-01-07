import SwiftUI
import Combine
import MediaPlayer
import UIKit
import SDWebImageSwiftUI
import AVFoundation
import FirebaseAnalytics

struct MusicWidget: View {
	let enrichedMetadata: EnrichedMetadata?
	let cardId          : String?
	let height          : CGFloat?
	
	init(
		enrichedMetadata: EnrichedMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil
	) {
		self.enrichedMetadata = enrichedMetadata
		self.cardId           = cardId
		self.height           = height
	}
	
	@State private var showInlineVideo = false
	@State private var inlineVideoEnded = false
	
	@State private var activeClipStart: Double? = nil
	@State private var activeClipDuration: Double? = nil
	@State private var selectedChapterIdx: Int? = nil
	
	@State private var videoPosterImage: UIImage?
	@State private var attemptedPosterLoad = false
	@State private var shouldFallbackToArtwork = false
	
	var body: some View {
		if let music = enrichedMetadata?.musicMetadata {
			content(for: music)
				.id(cardId)
				.overlay(InteractiveFrameReader())
				.onReceive(NotificationCenter.default.publisher(for: Notification.Name("StopInlineVideoForCard"))) { notif in
					guard showInlineVideo,
						  let cid = cardId,
						  let target = notif.userInfo?["cardID"] as? String,
						  target == cid else { return }
					var params: [String: Any] = [
						"screen": "curator" as NSString,
						"trigger": "card_change" as NSString
					]
					params["card_id"] = cid as NSString
					Analytics.logEvent("music_video_inline_auto_close", parameters: params)
					showInlineVideo = false
					inlineVideoEnded = false
				}
		}
	}
	
	@ViewBuilder
	private func content(for music: MusicMetadata) -> some View {
		let processedArtwork = processedArtworkURL(music.artworkURL)
		let trailer = music.videoURL
		let posterURL = music.videoPosterURL
		let isPodcast = (music.chapters?.isEmpty == false) || (music.transcriptURL != nil)
		let backgroundURL = shouldFallbackToArtwork ? processedArtwork : (posterURL ?? processedArtwork)
		
		if let trailer, showInlineVideo {
			ZStack(alignment: .bottomTrailing) {
				InlineVideoPlayer(
					url: trailer,
					height: height,
					autoPlay: true,
					forceMutedOnAutoplay: false,
					analyticsPlayEvent: "music_video_play",
					analyticsEndEvent:  "music_video_end",
					cardId: cardId,
					baseAnalyticsParams: ["widget_type": "music"],
					nowPlaying: NowPlayingMetadata(
						title: music.displayName,
						subtitle: music.displayArtist.isEmpty ? nil : music.displayArtist,
						artworkURL: backgroundURL
					),
					onPlay:  { inlineVideoEnded = false },
					onEnd:   { inlineVideoEnded = true  },
					onClose: { showInlineVideo = false; inlineVideoEnded = false }
				)
				.frame(maxWidth: .infinity)
				
				if inlineVideoEnded {
					OpenInPill(cardId: cardId, options: music.openInOptions())
						.padding(.trailing, 12)
						.padding(.bottom, 12)
						.transition(.move(edge: .trailing).combined(with: .opacity))
						.onAppear {
							var params: [String: Any] = [
								"screen": "curator" as NSString,
								"trigger": "auto_after_end" as NSString
							]
							if let cardId { params["card_id"] = cardId as NSString }
							Analytics.logEvent("inline_player_open_in_show", parameters: params)
						}
				}
			}
		} else {
			let preview = MusicPreview(
				cardId             : cardId,
				trackName          : music.displayName,
				trackArtist        : music.displayArtist,
				artworkURL         : processedArtwork,
				previewURL         : music.playablePreviewURL,
				appleMusicURL      : music.appleMusicURL,
				trailerURL         : trailer,
				style              : .bar,
				mediaKind          : isPodcast ? .podcast : .music,
				height             : height,
				clipStartSeconds   : activeClipStart,
				clipDurationSeconds: activeClipDuration,
				backgroundURL      : backgroundURL,
				onTrailerTap       : trailer == nil ? nil : {
					TextToSpeechService.shared.pauseQueue()
					var params: [String: Any] = [
						"screen": "curator" as NSString,
						"trigger": "trailer_button" as NSString
					]
					if let cardId { params["card_id"] = cardId as NSString }
					Analytics.logEvent("music_video_trailer_button_tap", parameters: params)
					Analytics.logEvent("music_video_inline_open", parameters: params)
					showInlineVideo = true
					inlineVideoEnded = false
				}
			)
				.frame(maxWidth: .infinity)
			
			ZStack {
				if let trailer {
					if let p = posterURL, !shouldFallbackToArtwork {
						posterFace(url: p)
					} else if let poster = videoPosterImage, !shouldFallbackToArtwork {
						posterFace(image: poster)
					} else {
						preview
					}
				} else {
					preview
				}
				
				if let chapters = music.chapters, !chapters.isEmpty {
					VStack {
						Spacer(minLength: 0)
						ScrollView(.horizontal, showsIndicators: false) {
							HStack(spacing: 8) {
								ForEach(Array(chapters.enumerated()), id: \.offset) { idx, ch in
									Button {
										selectedChapterIdx = idx
										if let st = ch.startSeconds {
											activeClipStart = st
											if let end = ch.endSeconds, end > st {
												activeClipDuration = min(90, end - st)
											} else {
												activeClipDuration = 60
											}
										}
										var p: [String: Any] = [
											"screen":"curator" as NSString,
											"trigger":"chapter_chip" as NSString,
											"chapter_idx": NSNumber(value: idx)
										]
										if let cardId { p["card_id"] = cardId as NSString }
										Analytics.logEvent("podcast_chapter_select", parameters: p)
									} label: {
										Text((ch.title?.isEmpty == false ? ch.title! : "Segment") )
											.font(.caption.weight(.semibold))
											.padding(.horizontal, 10).padding(.vertical, 6)
											.background(Capsule().fill(Color.white.opacity(0.15)))
									}
									.buttonStyle(.plain)
								}
							}
							.padding(.horizontal, 14)
							.padding(.vertical, 8)
						}
					}
				}
			}
			.overlay(alignment: .bottomTrailing) {
				HStack(spacing: 8) {
					OpenInPill(cardId: cardId, options: music.openInOptions())
				}
				.padding(.trailing, 16)
				.padding(.bottom, 16)
			}
			.onAppear {
				if isPodcast,
				   selectedChapterIdx == nil,
				   let hs = music.highlightStartSeconds,
				   let hd = music.highlightDurationSeconds {
					activeClipStart = hs
					activeClipDuration = hd
				}
				if let trailer, posterURL == nil, !attemptedPosterLoad {
					attemptedPosterLoad = true
					let seconds = (activeClipStart ?? 1.5)
					VideoPosterGenerator.shared.requestPoster(for: trailer, at: seconds, maxWidth: 1280) { img in
						DispatchQueue.main.async {
							guard let img else { return }
							if img.isVisuallyEmptyPoster {
								self.shouldFallbackToArtwork = true
								self.videoPosterImage = nil
							} else {
								self.videoPosterImage = img
							}
						}
					}
				}
			}
		}
	}
	
	private func posterFace(url: URL) -> some View {
		GeometryReader { geo in
			WebImage(url: url)
				.resizable()
				.onSuccess { image, _, _ in
					if image.isVisuallyEmptyPoster {
						shouldFallbackToArtwork = true
					}
				}
				.onFailure { _ in
					shouldFallbackToArtwork = true
				}
				.scaledToFill()
				.frame(width: geo.size.width, height: geo.size.height)
				.clipped()
				.contentShape(Rectangle())
				.overlay(playGlyph, alignment: .center)
				.onTapGesture {
					var params: [String: Any] = [
						"screen": "curator" as NSString,
						"trigger": "poster_tap" as NSString
					]
					if let cardId { params["card_id"] = cardId as NSString }
					Analytics.logEvent("music_video_poster_tap", parameters: params)
					Analytics.logEvent("music_video_inline_open", parameters: params)
					showInlineVideo = true
					inlineVideoEnded = false
				}
				.accessibilityAddTraits(.isButton)
		}
	}
	
	private func posterFace(image: UIImage) -> some View {
		GeometryReader { geo in
			Image(uiImage: image)
				.resizable()
				.scaledToFill()
				.frame(width: geo.size.width, height: geo.size.height)
				.clipped()
				.contentShape(Rectangle())
				.overlay(playGlyph, alignment: .center)
				.onTapGesture {
					var params: [String: Any] = [
						"screen": "curator" as NSString,
						"trigger": "poster_tap" as NSString
					]
					if let cardId { params["card_id"] = cardId as NSString }
					Analytics.logEvent("music_video_poster_tap", parameters: params)
					Analytics.logEvent("music_video_inline_open", parameters: params)
					showInlineVideo = true
					inlineVideoEnded = false
				}
				.accessibilityAddTraits(.isButton)
		}
	}
	
	private var playGlyph: some View {
		Image(systemName: "play.fill")
			.resizable()
			.scaledToFit()
			.frame(width: 30, height: 30)
			.foregroundColor(.white)
			.shadow(radius: 4)
	}
	
	private func processedArtworkURL(_ url: URL?) -> URL? {
		guard let url else { return nil }
		let s = url.absoluteString.replacingOccurrences(of: "{w}x{h}", with: "300x300")
		return URL(string: s)
	}
}

// ─────────── Section Header ───────────

private extension UIImage {
	var isVisuallyEmptyPoster: Bool {
		guard let cgImage else { return false }
		
		let sampleWidth  = 8
		let sampleHeight = 8
		let pixelCount   = sampleWidth * sampleHeight
		var pixels = [UInt8](repeating: 0, count: pixelCount * 4)
		
		guard let ctx = CGContext(
			data: &pixels,
			width: sampleWidth,
			height: sampleHeight,
			bitsPerComponent: 8,
			bytesPerRow: sampleWidth * 4,
			space: CGColorSpaceCreateDeviceRGB(),
			bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
		) else {
			return false
		}
		
		ctx.interpolationQuality = .none
		ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: sampleWidth, height: sampleHeight))
		
		var sum: Double = 0
		var minLum: Double = 1
		var maxLum: Double = 0
		
		for idx in stride(from: 0, to: pixels.count, by: 4) {
			let r = Double(pixels[idx])     / 255.0
			let g = Double(pixels[idx + 1]) / 255.0
			let b = Double(pixels[idx + 2]) / 255.0
			let luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
			sum += luminance
			minLum = min(minLum, luminance)
			maxLum = max(maxLum, luminance)
		}
		
		let avgLum = sum / Double(pixelCount)
		let range  = maxLum - minLum
		
		return avgLum < 0.02 && range < 0.02
	}
}

// ─────────── Section Header ───────────

private extension MusicMetadata {
	var playablePreviewURL: URL? {
		Mirror(reflecting: self).children
			.first { $0.label == "previewURL" || $0.label == "previewUrl" }
			.flatMap { $0.value as? URL }
	}
	
	var displayName: String {
		if let primary = Mirror(reflecting: self).children
			.first(where: { ["song", "name", "title", "trackName"].contains($0.label ?? "") })
			.flatMap({ $0.value as? String })?.trimmingCharacters(in: .whitespacesAndNewlines),
		   !primary.isEmpty { return primary }
		return Mirror(reflecting: self).children
			.first(where: { $0.label == "album" })
			.flatMap({ $0.value as? String }) ?? ""
	}
	
	var displayArtist: String {
		Mirror(reflecting: self).children
			.first { ["artistName", "artist"].contains($0.label ?? "") }
			.flatMap { $0.value as? String } ?? ""
	}
}

private final class MusicPreviewCoordinator {
	static let shared = MusicPreviewCoordinator()
	private var activeId: UUID?
	private init() {}
	func becomeActive(_ id: UUID) { activeId = id }
	func resignIfActive(_ id: UUID) { if activeId == id { activeId = nil } }
	func isActive(_ id: UUID) -> Bool { activeId == id }
}

// ─────────── Section Header ───────────

struct MusicPreview: View {
	enum Style { case bubble, bar }
	enum MediaKind { case music, podcast }
	
	let cardId        : String?
	let trackName     : String
	let trackArtist   : String
	let artworkURL    : URL?
	let previewURL    : URL?
	let appleMusicURL : URL?
	let trailerURL    : URL?
	let style         : Style
	let mediaKind     : MediaKind
	let height        : CGFloat?
	let clipStartSeconds   : Double?
	let clipDurationSeconds: Double?
	let backgroundURL : URL?
	let onTrailerTap  : (() -> Void)?
	
	private static let bubbleHeight: CGFloat = 200
	
	@State private var isPlaying         = false
	@State private var playbackProgress  : Double = 0
	@State private var durationSeconds   : Double = 0
	@State private var isPressed         = false
	@State private var hapticGenerator   : UIImpactFeedbackGenerator?
	@State private var instanceId        = UUID()
	
	@State private var lastCenterElapsed: Double = 0
	@State private var lastCenterUpdate  = Date()
	
	@Environment(\.openURL) private var openURL
	
	private let progressTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()
	private let tapDownScale: CGFloat = 0.965
	private let tapDownAnim  = Animation.spring(response: 0.18, dampingFraction: 0.7)
	private let tapUpAnim    = Animation.spring(response: 0.28, dampingFraction: 0.7)
	private let tapActionDelay: Double = 0.18
	
	private var center: SystemAudioCenter { .shared }
	
	init(cardId: String? = nil,
		 trackName: String,
		 trackArtist: String,
		 artworkURL: URL?,
		 previewURL: URL?,
		 appleMusicURL: URL? = nil,
		 trailerURL: URL? = nil,
		 style: Style,
		 mediaKind: MediaKind = .music,
		 height: CGFloat? = nil,
		 clipStartSeconds: Double? = nil,
		 clipDurationSeconds: Double? = nil,
		 backgroundURL: URL? = nil,
		 onTrailerTap: (() -> Void)? = nil) {
		self.cardId        = cardId
		self.trackName     = trackName
		self.trackArtist   = trackArtist
		self.artworkURL    = artworkURL
		self.previewURL    = previewURL
		self.appleMusicURL = appleMusicURL
		self.trailerURL    = trailerURL
		self.style         = style
		self.mediaKind     = mediaKind
		self.height        = height
		self.clipStartSeconds    = clipStartSeconds
		self.clipDurationSeconds = clipDurationSeconds
		self.backgroundURL = backgroundURL
		self.onTrailerTap  = onTrailerTap
	}
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : .infinity)
		
		GeometryReader { geo in
			let c = constants(for: geo.size.height)
			let radius = 24.0
			let shape: AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: radius))
			: AnyShape(RoundedCorner(radius: radius, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				ZStack {
					WebImage(url: artworkURL)
						.resizable()
						.scaledToFill()
						.frame(width: c.artwork, height: c.artwork)
						.clipShape(RoundedRectangle(cornerRadius: 24))
						.overlay(
							RoundedRectangle(cornerRadius: 24)
								.trim(from: 0, to: playbackProgress)
								.stroke(style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
								.foregroundStyle(Color.beige)
								.rotationEffect(.degrees(-90))
								.opacity(isPlaying ? 1 : 0)
								.allowsHitTesting(false)
						)
						.scaleEffect(isPressed ? tapDownScale : 1.0)
						.contentShape(Rectangle())
						.gesture(
							DragGesture(minimumDistance: 0)
								.onChanged { _ in
									guard previewURL != nil || trailerURL != nil else { return }
									if !isPressed {
										hapticGenerator = UIImpactFeedbackGenerator(style: .light)
										hapticGenerator?.prepare()
										withAnimation(tapDownAnim) { isPressed = true }
									}
								}
								.onEnded { _ in
									guard previewURL != nil || trailerURL != nil else {
										withAnimation(tapUpAnim) { isPressed = false }
										return
									}
									hapticGenerator?.impactOccurred(intensity: 0.7)
									withAnimation(tapUpAnim) { isPressed = false }
									DispatchQueue.main.asyncAfter(deadline: .now() + tapActionDelay) {
										Analytics.logEvent("music_artwork_tap", parameters: [
											"card_id": (cardId ?? "") as NSString,
											"screen": "curator" as NSString,
											"trigger": "tap" as NSString,
											"is_highlight": NSNumber(value: clipStartSeconds != nil)
										])
										if let _ = trailerURL {
											onTrailerTap?()
										} else {
											togglePlayback()
										}
									}
								}
						)
						.accessibilityAddTraits((previewURL != nil || trailerURL != nil) ? .isButton : [])
					
					if let iconName = centerGlyphIconName {
						Image(systemName: iconName)
							.resizable()
							.scaledToFit()
							.frame(width: c.icon, height: c.icon)
							.foregroundColor(.white)
							.shadow(radius: 3)
							.opacity(0.95)
							.allowsHitTesting(false)
					}
				}
				
				VStack(alignment: .leading, spacing: 2) {
					Text(trackName).font(.headline).foregroundColor(.white).lineLimit(2)
					Text(trackArtist).font(.subheadline).foregroundColor(.white.opacity(0.85)).lineLimit(2)
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, c.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background { ArtworkWave(url: backgroundURL ?? artworkURL, shape: shape) }
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.shadow(color: .black.opacity(0.15), radius: 4, x: 0, y: 3)
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight.isInfinite ? nil : fixedHeight)
		.transaction { $0.disablesAnimations = true }
		.onReceive(progressTimer) { now in
			guard center.activeRequestId == instanceId else {
				isPlaying = false
				playbackProgress = 0
				lastCenterElapsed = 0
				lastCenterUpdate  = now
				return
			}
			
			isPlaying = center.isPlaying
			
			let centerDuration = center.durationSeconds
			if centerDuration > 0 {
				durationSeconds = centerDuration
			}
			
			if center.isPlaying {
				if durationSeconds <= 0 {
					playbackProgress = 0
					lastCenterElapsed = center.elapsedSeconds
					lastCenterUpdate  = now
					return
				}
				
				let centerElapsed = center.elapsedSeconds
				if centerElapsed != lastCenterElapsed {
					lastCenterElapsed = centerElapsed
					lastCenterUpdate  = now
				}
				
				let estimatedElapsed = max(
					0,
					min(durationSeconds, lastCenterElapsed + now.timeIntervalSince(lastCenterUpdate))
				)
				playbackProgress = estimatedElapsed / durationSeconds
			} else {
				if durationSeconds > 0, center.elapsedSeconds >= durationSeconds {
					playbackProgress = 1
				}
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: Notification.Name("StopMusicPreview"))) { _ in
			if center.activeRequestId == instanceId, center.isPlaying {
				stopPlayback(reason: "card_change")
			}
		}
	}
	
	private var centerGlyphIconName: String? {
		if trailerURL != nil {
			return "film.fill"
		}
		if previewURL != nil {
			return isPlaying ? "stop.fill" : "play.fill"
		}
		return nil
	}
	
	private func constants(for h: CGFloat) -> (artwork: CGFloat, icon: CGFloat, pad: CGFloat) {
		switch style {
		case .bubble: return (max(0, h - 40), 26, 20)
		case .bar:    return (h * 0.8, max(h * 0.12, 18), 20)
		}
	}
	
	private func togglePlayback() {
		guard let url = previewURL else { return }
		let req = SystemAudioCenter.PlayRequest(
			id: instanceId,
			url: url,
			title: trackName,
			artist: trackArtist,
			artworkURL: artworkURL,
			kind: mediaKind == .podcast ? .podcast : .music,
			clipStart: clipStartSeconds,
			clipDuration: clipDurationSeconds
		)
		if center.activeRequestId == instanceId, center.isPlaying {
			stopPlayback(reason: "stopped")
		} else {
			TextToSpeechService.shared.pauseQueue()
			lastCenterElapsed = 0
			lastCenterUpdate  = Date()
			playbackProgress  = 0
			var startParams: [String: Any] = [
				"widget_type": "music" as NSString,
				"track_name": trackName as NSString,
				"track_artist": trackArtist as NSString,
				"screen": "curator" as NSString,
				"is_highlight": NSNumber(value: clipStartSeconds != nil)
			]
			if let cardId { startParams["card_id"] = cardId as NSString }
			Analytics.logEvent("widget_play_start", parameters: startParams)
			center.play(req)
		}
	}
	
	private func stopPlayback(reason: String) {
		guard center.activeRequestId == instanceId, center.isPlaying else { return }
		let elapsedMs = Int(center.elapsedSeconds * 1000)
		let pct = center.durationSeconds > 0 ? Int(round(min(max(center.elapsedSeconds / center.durationSeconds, 0), 1) * 100)) : 0
		center.stop(reason: reason)
		TextToSpeechService.shared.resumeQueue()
		var endParams: [String: Any] = [
			"screen": "curator" as NSString,
			"widget_type": "music" as NSString,
			"played_ms": NSNumber(value: elapsedMs),
			"completion_pct": NSNumber(value: pct),
			"reason": reason as NSString,
			"is_highlight": NSNumber(value: clipStartSeconds != nil)
		]
		if let cardId { endParams["card_id"] = cardId as NSString }
		Analytics.logEvent("widget_play_complete", parameters: endParams)
	}
}

// ─────────── Section Header ───────────

final class VideoPosterGenerator {
	static let shared = VideoPosterGenerator()
	private let cache = NSCache<NSString, UIImage>()
	
	private init() {
		cache.countLimit = 200
		cache.totalCostLimit = 48 * 1024 * 1024
	}
	
	func requestPoster(for url: URL, at seconds: Double, maxWidth: CGFloat = 1280, completion: @escaping (UIImage?) -> Void) {
		let key = url.absoluteString as NSString
		if let cached = cache.object(forKey: key) {
			completion(cached)
			return
		}
		
		DispatchQueue.global(qos: .userInitiated).async {
			let asset = AVURLAsset(url: url)
			let keys = ["tracks", "duration", "playable"]
			asset.loadValuesAsynchronously(forKeys: keys) {
				var ok = true
				for k in keys {
					var err: NSError?
					let status = asset.statusOfValue(forKey: k, error: &err)
					if status == .failed || status == .cancelled {
						ok = false
						break
					}
				}
				guard ok else {
					DispatchQueue.main.async { completion(nil) }
					return
				}
				
				let generator = AVAssetImageGenerator(asset: asset)
				generator.appliesPreferredTrackTransform = true
				if maxWidth > 0 {
					generator.maximumSize = CGSize(width: maxWidth, height: maxWidth * 9.0 / 16.0)
				}
				generator.requestedTimeToleranceBefore = CMTime(seconds: 0.4, preferredTimescale: 600)
				generator.requestedTimeToleranceAfter  = CMTime(seconds: 0.4, preferredTimescale: 600)
				
				let ts = asset.duration.timescale == 0 ? CMTimeScale(600) : asset.duration.timescale
				let primary   = CMTime(seconds: max(0.0, seconds), preferredTimescale: ts)
				let fallback1 = CMTime(seconds: 1.0, preferredTimescale: ts)
				
				func makeImage(at t: CMTime) -> UIImage? {
					do {
						let cg = try generator.copyCGImage(at: t, actualTime: nil)
						return UIImage(cgImage: cg)
					} catch {
						return nil
					}
				}
				
				var image = makeImage(at: primary)
				if image == nil { image = makeImage(at: fallback1) }
				
				DispatchQueue.main.async {
					if let img = image {
						let cost = Int(img.size.width * img.size.height) * 4
						self.cache.setObject(img, forKey: key, cost: cost)
						completion(img)
					} else {
						completion(nil)
					}
				}
			}
		}
	}
}
