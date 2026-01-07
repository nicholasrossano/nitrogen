import SwiftUI
import AVKit
import WebKit
import FirebaseAnalytics
import AVFoundation
import MediaPlayer
import UIKit

// ─────────── Now Playing Metadata ───────────
public struct NowPlayingMetadata {
	public let title: String
	public let subtitle: String?
	public let artworkURL: URL?
	
	public init(title: String, subtitle: String? = nil, artworkURL: URL? = nil) {
		self.title = title
		self.subtitle = subtitle
		self.artworkURL = artworkURL
	}
}

// ─────────── InlineVideoPlayer (reusable) ───────────
public struct InlineVideoPlayer: View {
	public let url: URL
	public let height: CGFloat?
	public let autoPlay: Bool
	public let forceMutedOnAutoplay: Bool
	public let analyticsPlayEvent: String?
	public let analyticsEndEvent: String?
	public let cardId: String?
	public let baseAnalyticsParams: [String: Any]
	public let nowPlaying: NowPlayingMetadata?
	public let onPlay: (() -> Void)?
	public let onEnd: (() -> Void)?
	public let onClose: (() -> Void)?
	
	@State private var player: AVPlayer?
	@State private var endObserver: Any?
	@State private var failObserver: Any?
	@State private var statusObserver: NSKeyValueObservation?
	@State private var didLogPlay = false
	
	@State private var reloadNonce: Int = 0
	@State private var errorCount: Int = 0
	@State private var didAutoOpenExternal = false
	
	@State private var showUnavailable = false
	@State private var unavailableReason: String?
	
	@State private var showFullscreen = false
	
	// ─────────── Audio session + lifecycle ───────────
	@State private var audioSessionActive = false
	@State private var interruptionObserver: Any?
	@State private var routeObserver: Any?
	@State private var isInBackground = false
	
	// ─────────── Session-level audio state ───────────
	@ObservedObject private var sessionAudioState = VideoSessionAudioState.shared
	
	// ─────────── Feature flags ───────────
	@ObservedObject private var featureFlags = FeatureFlagsManager.shared
	
	// ─────────── Web players ───────────
	@State private var youTubeWebView: WKWebView?
	@State private var vimeoWebView: WKWebView?
	
	// ─────────── Autoplay attempts ───────────
	@State private var autoplayToken: UUID?
	@State private var isPlaying: Bool = false
	
	// ─────────── Swipe smoothing ───────────
	@State private var isSwipeAnimating = false
	@State private var wasPlayingBeforeSwipe = false
	@State private var pendingSwipeEndWorkItem: DispatchWorkItem?
	
	@Environment(\.openURL) private var openURL
	@Environment(\.scenePhase) private var scenePhase
	
	public init(
		url: URL,
		height: CGFloat? = nil,
		autoPlay: Bool = true,
		forceMutedOnAutoplay: Bool = false,
		analyticsPlayEvent: String? = nil,
		analyticsEndEvent: String? = nil,
		cardId: String? = nil,
		baseAnalyticsParams: [String: Any] = [:],
		nowPlaying: NowPlayingMetadata? = nil,
		onPlay: (() -> Void)? = nil,
		onEnd:   (() -> Void)? = nil,
		onClose: (() -> Void)? = nil
	) {
		self.url = url
		self.height = height
		self.autoPlay = autoPlay
		self.forceMutedOnAutoplay = forceMutedOnAutoplay
		self.analyticsPlayEvent = analyticsPlayEvent
		self.analyticsEndEvent  = analyticsEndEvent
		self.cardId = cardId
		self.baseAnalyticsParams = baseAnalyticsParams
		self.nowPlaying = nowPlaying
		self.onPlay = onPlay
		self.onEnd  = onEnd
		self.onClose = onClose
	}
	
	public var body: some View {
		let provider = Self.provider(for: url)
		let shouldAutoplay = autoPlay
		let audioToggleEnabled = featureFlags.isAutoplayEnabled && Self.showsAudioToggle(for: provider)
		
		let content: AnyView = {
			switch provider {
			case .youtube(let id):
				return AnyView(
					YouTubeInlinePlayerView(
						videoID: id,
						initialMuted: effectiveIsMuted(forAttemptForceMute: false),
						webView: $youTubeWebView,
						onStateChange: { state in
							switch state {
							case .playing:
								handlePlay(provider: provider)
							case .ended:
								handleEnd(provider: provider)
							case .error(let code):
								handleYouTubeError(code, id: id)
							}
						}
					)
					.id("yt-\(id)-\(reloadNonce)")
					.opacity(isSwipeAnimating ? 0.0 : 1.0)
					.allowsHitTesting(!isSwipeAnimating)
				)
				
			case .vimeo(let id):
				return AnyView(
					VimeoInlinePlayerView(
						videoID: id,
						initialMuted: effectiveIsMuted(forAttemptForceMute: false),
						webView: $vimeoWebView,
						onStateChange: { state in
							switch state {
							case .playing:
								handlePlay(provider: provider)
							case .ended:
								handleEnd(provider: provider)
							case .error(let reason):
								autoOpenExternalOnce(
									URL(string: "https://vimeo.com/\(id)")!,
									provider: "vimeo",
									reason: reason ?? "privacy",
									code: nil
								)
							}
						}
					)
					.opacity(isSwipeAnimating ? 0.0 : 1.0)
					.allowsHitTesting(!isSwipeAnimating)
				)
				
			case .externalLogin(let host):
				return Color.black
					.onAppear {
						guard !didAutoOpenExternal else { return }
						autoOpenExternalOnce(url, provider: Self.providerName(fromHost: host), reason: "login_required", code: nil)
					}
					.eraseToAnyView()
				
			case .externalPaid(let host):
				return Color.black
					.onAppear {
						guard !didAutoOpenExternal else { return }
						autoOpenExternalOnce(url, provider: Self.providerName(fromHost: host), reason: "paid_platform", code: nil)
					}
					.eraseToAnyView()
				
			case .stream:
				return AnyView(
					ZStack {
						InlineAVPlayerView(player: player)
							.opacity(isSwipeAnimating ? 0.0 : 1.0)
							.allowsHitTesting(!isSwipeAnimating)
							.onAppear {
								NotificationCenter.default.post(name: Notification.Name("StopMusicPreview"), object: nil)
								activateAudioSessionForStream()
								
								let isMuted = effectiveIsMuted(forAttemptForceMute: false)
								
								if player == nil {
									let p = AVPlayer(url: url)
									p.isMuted = isMuted
									p.volume  = 1.0
									player = p
									addObservers(for: p)
								} else {
									player?.isMuted = isMuted
								}
								
								if shouldAutoplay && !isSwipeAnimating {
									startAutoplayAttempts(provider: provider, trigger: "on_appear_stream")
								}
							}
							.onDisappear {
								if !isInBackground {
									cleanup()
									deactivateAudioSessionIfNeeded()
								}
							}
						
						if showUnavailable {
							unavailableOverlay
						}
					}
				)
			}
		}()
		
		let v = content
			.frame(maxWidth: .infinity)
			.background(Color.black)
			.clipped()
			.overlay(alignment: .topLeading) {
				if onClose != nil || audioToggleEnabled {
					LiquidGlassPillContainer {
						HStack(spacing: 0) {
							if onClose != nil {
								LiquidGlassPillIconButton(
									systemName: "xmark",
									accessibilityLabel: "Close"
								) {
									var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
									params["trigger"] = "tap" as NSString
									Analytics.logEvent("inline_player_close_tap", parameters: params)
									cleanup()
									deactivateAudioSessionIfNeeded()
									onClose?()
								}
							}
							
							if onClose != nil && audioToggleEnabled {
								Rectangle()
									.fill(Color.white.opacity(0.35))
									.frame(width: 0.5, height: 18)
									.padding(.vertical, 6)
							}
							
							if audioToggleEnabled {
								LiquidGlassPillIconButton(
									systemName: sessionAudioState.isAudioEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill",
									accessibilityLabel: sessionAudioState.isAudioEnabled ? "Mute" : "Unmute"
								) {
									let newValue = !sessionAudioState.isAudioEnabled
									
									var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
									params["trigger"] = "tap" as NSString
									params["audio_enabled"] = NSNumber(value: newValue)
									params["provider"] = Self.analyticsProviderName(provider) as NSString
									Analytics.logEvent("inline_video_audio_toggle", parameters: params)
									
									sessionAudioState.setAudioEnabledFromUser(newValue)
									applySessionAudioToProvider(provider: provider)
									
									DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
										applySessionAudioToProvider(provider: provider)
									}
								}
							}
						}
					}
					.padding(10)
				}
			}
			.overlay(alignment: .topTrailing) {
				if case .stream = provider {
					LiquidGlassCircleButton(systemName: "arrow.up.left.and.arrow.down.right", accessibilityLabel: "Fullscreen") {
						var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
						params["trigger"] = "tap" as NSString
						Analytics.logEvent("inline_player_fullscreen_open", parameters: params)
						showFullscreen = true
					}
					.padding(10)
				}
			}
			.overlay {
				if isSwipeAnimating {
					if let art = nowPlaying?.artworkURL {
						AsyncImage(url: art) { img in
							img.resizable().scaledToFill()
						} placeholder: {
							Color.black
						}
						.clipped()
					} else {
						Color.black
					}
				}
			}
			.overlay {
				if showUnavailable {
					if case .stream = provider {
						EmptyView()
					} else {
						unavailableOverlay
					}
				}
			}
			.fullScreenCover(isPresented: $showFullscreen, onDismiss: {
				var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
				Analytics.logEvent("inline_player_fullscreen_close", parameters: params)
			}) {
				FullscreenAVPlayerContainer(player: player)
					.background(Color.black)
					.ignoresSafeArea()
			}
			.onChange(of: scenePhase) { newPhase in
				switch newPhase {
				case .active:
					isInBackground = false
				case .inactive, .background:
					isInBackground = true
				@unknown default:
					break
				}
			}
			.onAppear {
				sessionAudioState.applyDefaultAudioState(
					shouldMuteByDefault: shouldStartMutedByDefault(shouldAutoplay: shouldAutoplay)
				)
				if shouldAutoplay && !isSwipeAnimating {
					startAutoplayAttempts(provider: provider, trigger: "on_appear")
				}
				DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
					applySessionAudioToProvider(provider: provider)
				}
			}
			.onChange(of: sessionAudioState.isAudioEnabled) { _ in
				applySessionAudioToProvider(provider: provider)
			}
			.onReceive(NotificationCenter.default.publisher(for: .inlineVideoSwipeStateChanged)) { notif in
				handleSwipeStateChange(notif: notif, provider: provider)
			}
			.onReceive(NotificationCenter.default.publisher(for: .stopInlineVideoForCard)) { notif in
				handleStopNotification(notif: notif, provider: provider)
			}
		
		if let h = height { v.frame(height: h) } else { v }
	}
	
	// ─────────── Audio helpers ───────────
	private func effectiveIsMuted(forAttemptForceMute: Bool) -> Bool {
		if forceMutedOnAutoplay { return true }
		if forAttemptForceMute { return true }
		if !featureFlags.isAutoplayEnabled { return false }
		return !sessionAudioState.isAudioEnabled
	}
	
	private func shouldStartMutedByDefault(shouldAutoplay: Bool) -> Bool {
		guard featureFlags.isAutoplayEnabled else { return false }
		let autoplayEnabled = isAutoplayMediaEnabled()
		return shouldAutoplay && autoplayEnabled
	}
	
	private func isAutoplayMediaEnabled() -> Bool {
		let key = "autoplay_media_enabled"
		if let obj = UserDefaults.standard.object(forKey: key) as? Bool {
			return obj
		}
		return true
	}
	
	private func applySessionAudioToProvider(provider: Provider) {
		let isMuted = effectiveIsMuted(forAttemptForceMute: false)
		
		switch provider {
		case .stream:
			player?.isMuted = isMuted
			
		case .youtube:
			let muted = isMuted ? "true" : "false"
			youTubeWebView?.evaluateJavaScript("try{window.forewordSetMuted&&window.forewordSetMuted(\(muted));}catch(e){}", completionHandler: nil)
			
		case .vimeo:
			let muted = isMuted ? "true" : "false"
			vimeoWebView?.evaluateJavaScript("try{window.forewordSetMuted&&window.forewordSetMuted(\(muted));}catch(e){}", completionHandler: nil)
			
		case .externalLogin, .externalPaid:
			break
		}
	}
	
	// ─────────── Swipe smoothing ───────────
	private func handleSwipeStateChange(notif: Notification, provider: Provider) {
		guard let cid = cardId else { return }
		guard let target = notif.userInfo?["cardID"] as? String, target == cid else { return }
		
		let isSwiping = (notif.userInfo?["is_swiping"] as? Bool) ?? false
		let willCommit = (notif.userInfo?["will_commit"] as? Bool) ?? false
		let animMs = (notif.userInfo?["anim_ms"] as? Int) ?? 300
		
		pendingSwipeEndWorkItem?.cancel()
		pendingSwipeEndWorkItem = nil
		
		if isSwiping {
			autoplayToken = nil
			wasPlayingBeforeSwipe = isPlaying
			isSwipeAnimating = true
			triggerPause(provider: provider)
			return
		}
		
		if willCommit {
			autoplayToken = nil
			wasPlayingBeforeSwipe = false
			isSwipeAnimating = true
			triggerPause(provider: provider)
			
			let work = DispatchWorkItem {
				self.isSwipeAnimating = false
			}
			pendingSwipeEndWorkItem = work
			DispatchQueue.main.asyncAfter(deadline: .now() + Double(animMs) / 1000.0 + 0.02, execute: work)
			return
		}
		
		isSwipeAnimating = false
		if wasPlayingBeforeSwipe {
			wasPlayingBeforeSwipe = false
			startAutoplayAttempts(provider: provider, trigger: "swipe_cancel_resume")
		}
	}
	
	private func handleStopNotification(notif: Notification, provider: Provider) {
		guard let cid = cardId else { return }
		guard let target = notif.userInfo?["cardID"] as? String, target == cid else { return }
		
		autoplayToken = nil
		triggerPause(provider: provider)
		
		let deferMs = (notif.userInfo?["defer_ui_close_ms"] as? Int) ?? 0
		if deferMs > 0 {
			isSwipeAnimating = true
			pendingSwipeEndWorkItem?.cancel()
			let work = DispatchWorkItem {
				self.isSwipeAnimating = false
			}
			pendingSwipeEndWorkItem = work
			DispatchQueue.main.asyncAfter(deadline: .now() + Double(deferMs) / 1000.0 + 0.02, execute: work)
		} else {
			isSwipeAnimating = false
		}
	}
	
	// ─────────── Autoplay helpers ───────────
	private func startAutoplayAttempts(provider: Provider, trigger: String) {
		let token = UUID()
		autoplayToken = token
		
		let delays: [Double] = [0.0, 0.15, 0.35, 0.65, 1.0]
		for (idx, d) in delays.enumerated() {
			DispatchQueue.main.asyncAfter(deadline: .now() + d) {
				guard self.autoplayToken == token else { return }
				guard !self.showUnavailable else { return }
				guard !self.isSwipeAnimating else { return }
				
				let attempt = idx + 1
				self.triggerPlay(provider: provider, attempt: attempt, trigger: trigger)
			}
		}
	}
	
	private func triggerPlay(provider: Provider, attempt: Int, trigger: String) {
		let forceMuteAttempt = attempt >= 3
		let forceMute = forceMutedOnAutoplay || forceMuteAttempt
		
		var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
		params["trigger"] = trigger as NSString
		params["attempt"] = NSNumber(value: attempt)
		params["provider"] = Self.analyticsProviderName(provider) as NSString
		params["force_mute"] = NSNumber(value: forceMute)
		Analytics.logEvent("inline_video_autoplay_attempt", parameters: params)
		
		switch provider {
		case .youtube:
			let jsMute = "try{window.forewordSetMuted&&window.forewordSetMuted(\(effectiveIsMuted(forAttemptForceMute: forceMute) ? "true" : "false"));}catch(e){}"
			let jsPlay = "try{window.forewordPlay&&window.forewordPlay(\(forceMute ? "true" : "false"));}catch(e){}"
			youTubeWebView?.evaluateJavaScript(jsMute, completionHandler: nil)
			youTubeWebView?.evaluateJavaScript(jsPlay, completionHandler: nil)
			
		case .vimeo:
			let jsMute = "try{window.forewordSetMuted&&window.forewordSetMuted(\(effectiveIsMuted(forAttemptForceMute: forceMute) ? "true" : "false"));}catch(e){}"
			let jsPlay = "try{window.forewordPlay&&window.forewordPlay(\(forceMute ? "true" : "false"));}catch(e){}"
			vimeoWebView?.evaluateJavaScript(jsMute, completionHandler: nil)
			vimeoWebView?.evaluateJavaScript(jsPlay, completionHandler: nil)
			
		case .stream:
			player?.isMuted = effectiveIsMuted(forAttemptForceMute: forceMute)
			player?.play()
			
		case .externalLogin, .externalPaid:
			break
		}
		
		if forceMuteAttempt {
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
				applySessionAudioToProvider(provider: provider)
			}
		}
	}
	
	private func triggerPause(provider: Provider) {
		switch provider {
		case .youtube:
			youTubeWebView?.evaluateJavaScript("try{window.forewordPause&&window.forewordPause();}catch(e){}", completionHandler: nil)
		case .vimeo:
			vimeoWebView?.evaluateJavaScript("try{window.forewordPause&&window.forewordPause();}catch(e){}", completionHandler: nil)
		case .stream:
			player?.pause()
		case .externalLogin, .externalPaid:
			break
		}
	}
	
	// ─────────── Play/End handlers ───────────
	private func handlePlay(provider: Provider) {
		isPlaying = true
		NotificationCenter.default.post(name: Notification.Name("StopMusicPreview"), object: nil)
		
		applySessionAudioToProvider(provider: provider)
		
		if !didLogPlay {
			didLogPlay = true
			TextToSpeechService.shared.pauseQueue()
			
			var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
			if let name = analyticsPlayEvent { Analytics.logEvent(name, parameters: params) }
			onPlay?()
		}
		
		if case .stream = provider, let player {
			NowPlayingManager.shared.activate(
				player: player,
				cardId: cardId,
				baseParams: baseAnalyticsParams,
				metadata: nowPlaying
			)
		}
	}
	
	private func handleEnd(provider: Provider) {
		isPlaying = false
		TextToSpeechService.shared.resumeQueue()
		
		var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
		if let name = analyticsEndEvent { Analytics.logEvent(name, parameters: params) }
		onEnd?()
		
		NowPlayingManager.shared.deactivate()
	}
	
	private func handleYouTubeError(_ code: Int, id: String) {
		var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
		params["code"] = NSNumber(value: code)
		Analytics.logEvent("inline_video_youtube_error", parameters: params)
		
		if code == 153 && errorCount == 0 {
			errorCount = 1
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
				reloadNonce &+= 1
			}
			return
		}
		
		if (code == 2 || code == 5) {
			if errorCount == 0 {
				errorCount = 1
				DispatchQueue.main.async { reloadNonce &+= 1 }
			} else {
				if let watch = URL(string: "https://www.youtube.com/watch?v=\(id)") {
					autoOpenExternalOnce(watch, provider: "youtube", reason: "param_error", code: code)
				}
			}
			return
		}
		
		if (code == 150 || code == 101) {
			if let watch = URL(string: "https://www.youtube.com/watch?v=\(id)") {
				autoOpenExternalOnce(watch, provider: "youtube", reason: "age_gate", code: code)
			}
			return
		}
		
		if code == 100 {
			showUnavailable = true
			unavailableReason = "Video unavailable"
			return
		}
	}
	
	// ─────────── AVPlayer observers ───────────
	private func addObservers(for player: AVPlayer) {
		endObserver = NotificationCenter.default.addObserver(
			forName: .AVPlayerItemDidPlayToEndTime,
			object: player.currentItem,
			queue: .main
		) { _ in
			handleEnd(provider: .stream)
		}
		
		failObserver = NotificationCenter.default.addObserver(
			forName: .AVPlayerItemFailedToPlayToEndTime,
			object: player.currentItem,
			queue: .main
		) { _ in
			handleAVFailure(player)
		}
		
		statusObserver = player.observe(\.timeControlStatus, options: [.new]) { p, _ in
			if p.timeControlStatus == .playing {
				handlePlay(provider: .stream)
			}
		}
		
		interruptionObserver = NotificationCenter.default.addObserver(
			forName: AVAudioSession.interruptionNotification,
			object: nil,
			queue: .main
		) { note in
			guard let info = note.userInfo,
				  let typeVal = info[AVAudioSessionInterruptionTypeKey] as? UInt,
				  let type = AVAudioSession.InterruptionType(rawValue: typeVal) else { return }
			switch type {
			case .began:
				player.pause()
			case .ended:
				if let optVal = info[AVAudioSessionInterruptionOptionKey] as? UInt {
					let opts = AVAudioSession.InterruptionOptions(rawValue: optVal)
					if opts.contains(.shouldResume) { player.play() }
				}
			@unknown default:
				break
			}
		}
		
		routeObserver = NotificationCenter.default.addObserver(
			forName: AVAudioSession.routeChangeNotification,
			object: nil,
			queue: .main
		) { _ in
			if audioSessionActive {
				try? AVAudioSession.sharedInstance().setActive(true)
			}
		}
	}
	
	private func handleAVFailure(_ player: AVPlayer) {
		let errDesc = player.currentItem?.error?.localizedDescription ?? "failed"
		var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
		params["reason"] = "av_fail" as NSString
		params["error"]  = errDesc as NSString
		Analytics.logEvent("inline_video_stream_fail", parameters: params)
		
		showUnavailable = true
		unavailableReason = "Video unavailable"
	}
	
	private func cleanup() {
		autoplayToken = nil
		isPlaying = false
		
		player?.pause()
		
		if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
		if let failObserver { NotificationCenter.default.removeObserver(failObserver) }
		if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
		if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
		
		endObserver = nil
		failObserver = nil
		interruptionObserver = nil
		routeObserver = nil
		statusObserver = nil
		
		TextToSpeechService.shared.resumeQueue()
		showUnavailable = false
		unavailableReason = nil
		NowPlayingManager.shared.deactivate()
	}
	
	private func autoOpenExternalOnce(_ url: URL, provider: String, reason: String, code: Int?) {
		guard !didAutoOpenExternal else { return }
		didAutoOpenExternal = true
		
		var params = Self.analyticsParams(cardId: cardId, base: baseAnalyticsParams)
		params["provider"] = provider as NSString
		params["reason"]   = reason as NSString
		params["trigger"]  = "inline" as NSString
		if let code { params["code"] = NSNumber(value: code) }
		Analytics.logEvent("inline_video_external_auto_open", parameters: params)
		DispatchQueue.main.async { openURL(url) }
	}
	
	private var unavailableOverlay: some View {
		VStack(spacing: 10) {
			Text(unavailableReason ?? "Video unavailable")
				.font(.footnote)
				.foregroundColor(.white.opacity(0.9))
				.multilineTextAlignment(.center)
				.padding(.horizontal, 16)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(Color.black)
	}
	
	private static func analyticsParams(cardId: String?, base: [String: Any]) -> [String: Any] {
		var out: [String: Any] = [:]
		
		let screen: NSString = {
			if let s = base["screen"] as? String { return s as NSString }
			if let s = base["screen"] as? NSString { return s }
			return "home" as NSString
		}()
		out["screen"] = screen
		
		if let cardId { out["card_id"] = cardId as NSString }
		
		if let t = base["topic_id"] as? String {
			out["topic_id"] = t as NSString
		} else if let t = base["topic_id"] as? NSString {
			out["topic_id"] = t
		} else {
			out["topic_id"] = "unknown" as NSString
		}
		
		for (k, v) in base {
			switch v {
			case let s as String:   out[k] = s as NSString
			case let b as Bool:     out[k] = NSNumber(value: b)
			case let i as Int:      out[k] = NSNumber(value: i)
			case let d as Double:   out[k] = NSNumber(value: d)
			case let n as NSNumber: out[k] = n
			case let s as NSString: out[k] = s
			default: break
			}
		}
		return out
	}
	
	// ─────────── Provider routing ───────────
	private enum Provider {
		case youtube(id: String)
		case vimeo(id: String)
		case stream
		case externalLogin(host: String)
		case externalPaid(host: String)
	}
	
	private static func showsAudioToggle(for provider: Provider) -> Bool {
		switch provider {
		case .youtube, .vimeo, .stream:
			return true
		case .externalLogin, .externalPaid:
			return false
		}
	}
	
	private static func analyticsProviderName(_ provider: Provider) -> String {
		switch provider {
		case .youtube: return "youtube"
		case .vimeo: return "vimeo"
		case .stream: return "stream"
		case .externalLogin(let host): return providerName(fromHost: host)
		case .externalPaid(let host): return providerName(fromHost: host)
		}
	}
	
	private static func provider(for url: URL) -> Provider {
		if let id = youtubeID(from: url) { return .youtube(id: id) }
		if let id = vimeoID(from: url) { return .vimeo(id: id) }
		
		let host = (url.host ?? "").lowercased()
		
		if isLoginGatedHost(host) {
			return .externalLogin(host: host)
		}
		if isPaidPlatformHost(host) {
			return .externalPaid(host: host)
		}
		return .stream
	}
	
	private static func youtubeID(from url: URL) -> String? {
		let host = (url.host ?? "").lowercased()
		if host.contains("youtu.be") { return url.lastPathComponent }
		if host.contains("youtube.com") {
			if let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?
				.queryItems?
				.first(where: { $0.name == "v" })?.value {
				return id
			}
			let comps = url.pathComponents
			if let idx = comps.firstIndex(of: "embed"), idx + 1 < comps.count {
				return comps[idx + 1]
			}
			if let idx = comps.firstIndex(of: "shorts"), idx + 1 < comps.count {
				return comps[idx + 1]
			}
		}
		return nil
	}
	
	private static func vimeoID(from url: URL) -> String? {
		let host = (url.host ?? "").lowercased()
		guard host.contains("vimeo.com") else { return nil }
		let path = url.path
		if let match = path.range(of: #"/video/(\d+)"#, options: .regularExpression) {
			let s = String(path[match])
			if let id = s.split(separator: "/").last { return String(id) }
		}
		if let match = path.range(of: #"/(\d+)"#, options: .regularExpression) {
			let id = String(path[match]).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
			if Int(id) != nil { return id }
		}
		return nil
	}
	
	private static func isLoginGatedHost(_ host: String) -> Bool {
		return host.contains("tiktok.com")
		|| host.contains("instagram.com")
		|| host == "x.com"
		|| host.contains("twitter.com")
		|| host.contains("facebook.com")
	}
	
	private static func isPaidPlatformHost(_ host: String) -> Bool {
		return host.contains("netflix.com")
		|| host.contains("max.com")
		|| host.contains("disneyplus.com")
		|| host.contains("hulu.com")
		|| host.contains("primevideo.com")
		|| (host.contains("amazon.com") && host.contains("video"))
		|| host.contains("tv.apple.com")
		|| host.contains("peacocktv.com")
		|| host.contains("paramountplus.com")
		|| host.contains("starz.com")
		|| host.contains("showtime.com")
	}
	
	private static func providerName(fromHost host: String) -> String {
		let h = host.lowercased()
		if h.contains("youtube") || h.contains("youtu.be") { return "youtube" }
		if h.contains("vimeo") { return "vimeo" }
		if h.contains("tiktok") { return "tiktok" }
		if h.contains("instagram") { return "instagram" }
		if h == "x.com" || h.contains("twitter") { return "x" }
		if h.contains("facebook") { return "facebook" }
		if h.contains("netflix") { return "netflix" }
		if h.contains("disneyplus") { return "disneyplus" }
		if h.contains("primevideo") || (h.contains("amazon") && h.contains("video")) { return "primevideo" }
		if h.contains("tv.apple.com") { return "appletv" }
		if h.contains("hulu") { return "hulu" }
		if h.contains("peacock") { return "peacock" }
		if h.contains("paramountplus") { return "paramountplus" }
		if h.contains("starz") { return "starz" }
		if h.contains("showtime") { return "showtime" }
		return h
	}
	
	// ─────────── Audio session for stream ───────────
	private func activateAudioSessionForStream() {
		guard !audioSessionActive else { return }
		let session = AVAudioSession.sharedInstance()
		do {
			try session.setMode(.moviePlayback)
			try session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay, .duckOthers])
			try session.setActive(true)
			audioSessionActive = true
		} catch {
			audioSessionActive = false
		}
	}
	
	private func deactivateAudioSessionIfNeeded() {
		guard audioSessionActive else { return }
		try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
		audioSessionActive = false
	}
}

// ─────────── YouTube Inline Player (WKWebView) ───────────
private struct YouTubeInlinePlayerView: UIViewRepresentable {
	enum State { case playing, ended, error(Int) }
	let videoID: String
	let initialMuted: Bool
	@Binding var webView: WKWebView?
	let onStateChange: (State) -> Void
	
	private static let embedOrigin = URL(string: "https://localhost/foreword")!
	
	func makeUIView(context: Context) -> WKWebView {
		let config = WKWebViewConfiguration()
		config.allowsInlineMediaPlayback = true
		config.allowsPictureInPictureMediaPlayback = true
		if #available(iOS 10.0, *) {
			config.mediaTypesRequiringUserActionForPlayback = []
		} else {
			config.requiresUserActionForMediaPlayback = false
		}
		config.userContentController.add(context.coordinator, name: "foreword")
		
		let web = WKWebView(frame: .zero, configuration: config)
		web.scrollView.isScrollEnabled = false
		web.backgroundColor = .black
		web.isOpaque = false
		web.navigationDelegate = context.coordinator
		
		DispatchQueue.main.async { self.webView = web }
		
		let mutedValue = initialMuted ? "true" : "false"
		let html = [
			"<!doctype html>",
			"<html><head>",
			"<meta name=\"viewport\" content=\"initial-scale=1, maximum-scale=1, viewport-fit=cover\">",
			"<style>html,body,#player{margin:0;padding:0;background:#000;height:100%;overflow:hidden}</style>",
			"</head><body>",
			"<div id=\"player\"></div>",
			"<script src=\"https://www.youtube.com/iframe_api\"></script>",
			"<script>",
			"var player=null;",
			"var ready=false;",
			"var pendingPlay=false;",
			"var pendingMute=\(mutedValue);",
			"window.forewordSetMuted=function(m){ pendingMute=!!m; try{ if(player){ if(pendingMute){player.mute();}else{player.unMute();} } }catch(e){} };",
			"window.forewordPause=function(){ try{ if(player){ player.pauseVideo(); } }catch(e){} };",
			"window.forewordPlay=function(forceMute){",
			"  try{ if(forceMute){ pendingMute=true; } }catch(e){}",
			"  if(!ready){ pendingPlay=true; return; }",
			"  try{ window.forewordSetMuted(pendingMute); }catch(e){}",
			"  try{ player.playVideo(); }catch(e){ pendingPlay=true; }",
			"};",
			"function onYouTubeIframeAPIReady(){",
			"  player=new YT.Player('player',{",
			"    height:'100%',width:'100%',videoId:'\(videoID)',host:'https://www.youtube.com',",
			"    playerVars:{playsinline:1,modestbranding:1,rel:0,controls:1,autoplay:0} ,",
			"    events:{",
			"      onReady:function(){",
			"        ready=true;",
			"        try{ window.forewordSetMuted(pendingMute); }catch(e){}",
			"        if(pendingPlay){ pendingPlay=false; try{ player.playVideo(); }catch(e){} }",
			"      },",
			"      onStateChange:function(e){",
			"        if(e.data===1){window.webkit.messageHandlers.foreword.postMessage('playing');}",
			"        if(e.data===0){window.webkit.messageHandlers.foreword.postMessage('ended');}",
			"      },",
			"      onError:function(e){ try{window.webkit.messageHandlers.foreword.postMessage('error:'+e.data);}catch(_){} }",
			"    }",
			"  });",
			"}",
			"</script></body></html>"
		].joined(separator: "\n")
		
		web.loadHTMLString(html, baseURL: Self.embedOrigin)
		return web
	}
	
	func updateUIView(_ uiView: WKWebView, context: Context) {}
	
	func makeCoordinator() -> Coordinator { Coordinator(onStateChange: onStateChange) }
	
	final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
		let onStateChange: (State) -> Void
		init(onStateChange: @escaping (State) -> Void) { self.onStateChange = onStateChange }
		
		func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
			guard message.name == "foreword", let str = message.body as? String else { return }
			if str == "playing" { onStateChange(.playing) }
			else if str == "ended" { onStateChange(.ended) }
			else if str.hasPrefix("error:") {
				let codeStr = String(str.dropFirst("error:".count))
				if let c = Int(codeStr) { onStateChange(.error(c)) }
			}
		}
	}
}

// ─────────── Vimeo Inline Player (WKWebView + Player.js) ───────────
private struct VimeoInlinePlayerView: UIViewRepresentable {
	enum State { case playing, ended, error(String?) }
	let videoID: String
	let initialMuted: Bool
	@Binding var webView: WKWebView?
	let onStateChange: (State) -> Void
	
	private static let embedOrigin = URL(string: "https://localhost/foreword")!
	
	func makeUIView(context: Context) -> WKWebView {
		let config = WKWebViewConfiguration()
		config.allowsInlineMediaPlayback = true
		config.allowsPictureInPictureMediaPlayback = true
		if #available(iOS 10.0, *) {
			config.mediaTypesRequiringUserActionForPlayback = []
		} else {
			config.requiresUserActionForMediaPlayback = false
		}
		config.userContentController.add(context.coordinator, name: "foreword")
		
		let web = WKWebView(frame: .zero, configuration: config)
		web.scrollView.isScrollEnabled = false
		web.backgroundColor = .black
		web.isOpaque = false
		
		DispatchQueue.main.async { self.webView = web }
		
		let muted = initialMuted ? "true" : "false"
		let html = [
			"<!doctype html>",
			"<html><head>",
			"<meta name=\"viewport\" content=\"initial-scale=1, maximum-scale=1, viewport-fit=cover\">",
			"<style>html,body,#player{margin:0;padding:0;background:#000;height:100%;overflow:hidden}</style>",
			"</head><body>",
			"<div id=\"player\"></div>",
			"<script src=\"https://player.vimeo.com/api/player.js\"></script>",
			"<script>",
			"var p = new Vimeo.Player('player', { id: \(videoID), autoplay: false, muted: \(muted), byline: false, title: false, portrait: false, controls: true });",
			"var ready=false; var pendingPlay=false; var pendingMute=\(muted);",
			"window.forewordSetMuted=function(m){ pendingMute=!!m; try{ if(p){ p.setMuted(pendingMute); } }catch(e){} };",
			"window.forewordPause=function(){ try{ if(p){ p.pause(); } }catch(e){} };",
			"window.forewordPlay=function(forceMute){ try{ if(forceMute){ pendingMute=true; } }catch(e){} if(!ready){ pendingPlay=true; return; } try{ window.forewordSetMuted(pendingMute); }catch(e){} try{ p.play(); }catch(e){ pendingPlay=true; } };",
			"p.ready().then(function(){ ready=true; if(pendingPlay){ pendingPlay=false; try{ p.play(); }catch(e){} } });",
			"p.on('play', function(){ try{window.webkit.messageHandlers.foreword.postMessage('playing');}catch(_){} });",
			"p.on('ended', function(){ try{window.webkit.messageHandlers.foreword.postMessage('ended');}catch(_){} });",
			"p.on('error', function(e){ var reason = (e && (e.name||e.message)) || 'error'; try{window.webkit.messageHandlers.foreword.postMessage('error:'+reason);}catch(_){ } });",
			"</script></body></html>"
		].joined(separator: "\n")
		
		web.loadHTMLString(html, baseURL: Self.embedOrigin)
		return web
	}
	
	func updateUIView(_ uiView: WKWebView, context: Context) {}
	
	func makeCoordinator() -> Coordinator { Coordinator(onStateChange: onStateChange) }
	
	final class Coordinator: NSObject, WKScriptMessageHandler {
		let onStateChange: (State) -> Void
		init(onStateChange: @escaping (State) -> Void) { self.onStateChange = onStateChange }
		
		func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
			guard message.name == "foreword", let str = message.body as? String else { return }
			if str == "playing" { onStateChange(.playing) }
			else if str == "ended" { onStateChange(.ended) }
			else if str.hasPrefix("error:") {
				let reason = String(str.dropFirst("error:".count))
				onStateChange(.error(reason))
			}
		}
	}
}

// ─────────── Inline AVPlayerViewController Wrapper ───────────
private struct InlineAVPlayerView: UIViewControllerRepresentable {
	let player: AVPlayer?
	
	func makeUIViewController(context: Context) -> AVPlayerViewController {
		let vc = AVPlayerViewController()
		vc.player = player
		vc.showsPlaybackControls = true
		vc.entersFullScreenWhenPlaybackBegins = false
		vc.exitsFullScreenWhenPlaybackEnds = true
		vc.allowsPictureInPicturePlayback = true
		if #available(iOS 14.0, *) {
			vc.canStartPictureInPictureAutomaticallyFromInline = true
		}
		return vc
	}
	
	func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
		uiViewController.player = player
	}
}

// ─────────── Fullscreen AVPlayer Container ───────────
private struct FullscreenAVPlayerContainer: UIViewControllerRepresentable {
	let player: AVPlayer?
	
	func makeUIViewController(context: Context) -> AVPlayerViewController {
		let vc = AVPlayerViewController()
		vc.player = player
		vc.showsPlaybackControls = true
		vc.entersFullScreenWhenPlaybackBegins = false
		vc.exitsFullScreenWhenPlaybackEnds = true
		vc.allowsPictureInPicturePlayback = true
		if #available(iOS 14.0, *) {
			vc.canStartPictureInPictureAutomaticallyFromInline = true
		}
		return vc
	}
	
	func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {
		uiViewController.player = player
	}
}

// ─────────── Liquid Glass Pill Container ───────────
private struct LiquidGlassPillContainer<Content: View>: View {
	let content: Content
	
	init(@ViewBuilder content: () -> Content) {
		self.content = content()
	}
	
	var body: some View {
		content
			.padding(.horizontal, 2)
			.padding(.vertical, 2)
			.background {
				Capsule()
					.fill(.ultraThinMaterial)
					.overlay(Capsule().stroke(Color.white.opacity(0.6), lineWidth: 0.5))
					.shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 4)
			}
	}
}

// ─────────── Liquid Glass Pill Icon Button ───────────
private struct LiquidGlassPillIconButton: View {
	let systemName: String
	let accessibilityLabel: String
	let action: () -> Void
	
	@State private var pressed = false
	
	init(systemName: String, accessibilityLabel: String = "Button", action: @escaping () -> Void) {
		self.systemName = systemName
		self.accessibilityLabel = accessibilityLabel
		self.action = action
	}
	
	var body: some View {
		Button {
			UIImpactFeedbackGenerator(style: .light).impactOccurred()
			action()
		} label: {
			Image(systemName: systemName)
				.font(.system(size: 13, weight: .bold))
				.foregroundColor(.white)
				.frame(width: 34, height: 34)
				.contentShape(Rectangle())
				.scaleEffect(pressed ? 0.95 : 1.0)
		}
		.buttonStyle(.plain)
		.simultaneousGesture(
			DragGesture(minimumDistance: 0)
				.onChanged { _ in
					if !pressed {
						withAnimation(.spring(response: 0.18, dampingFraction: 0.7)) { pressed = true }
					}
				}
				.onEnded { _ in
					withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) { pressed = false }
				}
		)
		.accessibilityLabel(accessibilityLabel)
	}
}

// ─────────── Liquid Glass Circle Button ───────────
private struct LiquidGlassCircleButton: View {
	let systemName: String
	let accessibilityLabel: String
	let action: () -> Void
	
	@State private var pressed = false
	
	init(systemName: String, accessibilityLabel: String = "Button", action: @escaping () -> Void) {
		self.systemName = systemName
		self.accessibilityLabel = accessibilityLabel
		self.action = action
	}
	
	var body: some View {
		Button {
			UIImpactFeedbackGenerator(style: .light).impactOccurred()
			action()
		} label: {
			ZStack {
				Circle()
					.fill(.ultraThinMaterial)
					.overlay(Circle().stroke(Color.white.opacity(0.6), lineWidth: 0.5))
					.shadow(color: .black.opacity(0.18), radius: 10, x: 0, y: 4)
				Image(systemName: systemName)
					.font(.system(size: 13, weight: .bold))
					.foregroundColor(.white)
			}
			.frame(width: 34, height: 34)
			.scaleEffect(pressed ? 0.95 : 1.0)
		}
		.buttonStyle(.plain)
		.simultaneousGesture(
			DragGesture(minimumDistance: 0)
				.onChanged { _ in
					if !pressed {
						withAnimation(.spring(response: 0.18, dampingFraction: 0.7)) { pressed = true }
					}
				}
				.onEnded { _ in
					withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) { pressed = false }
				}
		)
		.accessibilityLabel(accessibilityLabel)
	}
}

private extension View {
	func eraseToAnyView() -> AnyView { AnyView(self) }
}

// ─────────── Now Playing Manager ───────────
private final class NowPlayingManager {
	static let shared = NowPlayingManager()
	
	private var player: AVPlayer?
	private var timeObserver: Any?
	private var isActive = false
	private var baseParams: [String: Any] = [:]
	private var cardId: String?
	
	private init() { }
	
	func activate(player: AVPlayer, cardId: String?, baseParams: [String: Any], metadata: NowPlayingMetadata?) {
		guard !isActive else { return }
		self.player = player
		self.cardId = cardId
		self.baseParams = baseParams
		self.isActive = true
		
		var info: [String: Any] = [:]
		info[MPMediaItemPropertyTitle] = (metadata?.title ?? "Video") as NSString
		if let sub = metadata?.subtitle { info[MPMediaItemPropertyAlbumTitle] = sub as NSString }
		info[MPNowPlayingInfoPropertyMediaType] = NSNumber(value: MPNowPlayingInfoMediaType.video.rawValue)
		
		if let duration = player.currentItem?.asset.duration.seconds, duration.isFinite {
			info[MPMediaItemPropertyPlaybackDuration] = NSNumber(value: duration)
		}
		info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = NSNumber(value: player.currentTime().seconds)
		info[MPNowPlayingInfoPropertyPlaybackRate] = NSNumber(value: player.timeControlStatus == .playing ? 1.0 : 0.0)
		
		MPNowPlayingInfoCenter.default().nowPlayingInfo = info
		
		timeObserver = player.addPeriodicTimeObserver(forInterval: CMTimeMake(value: 1, timescale: 2), queue: .main) { _ in
			guard var now = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
			now[MPNowPlayingInfoPropertyElapsedPlaybackTime] = NSNumber(value: player.currentTime().seconds)
			now[MPNowPlayingInfoPropertyPlaybackRate] = NSNumber(value: player.timeControlStatus == .playing ? 1.0 : 0.0)
			MPNowPlayingInfoCenter.default().nowPlayingInfo = now
		}
	}
	
	func deactivate() {
		guard isActive else { return }
		isActive = false
		
		if let player = player, let timeObserver = timeObserver {
			player.removeTimeObserver(timeObserver)
		}
		timeObserver = nil
		player = nil
		cardId = nil
		baseParams = [:]
		
		MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
	}
}

// ─────────── Notification Names ───────────
extension Notification.Name {
	static let autoPlayMediaForCard  = Notification.Name("AutoPlayMediaForCard")
	static let cardSwipeStateChanged = Notification.Name("CardSwipeStateChanged")
}
