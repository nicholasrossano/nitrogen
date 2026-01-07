import Foundation
import AVFoundation
import MediaPlayer
import UIKit

// ─────────── TextToSpeechService ───────────
final class TextToSpeechService: NSObject, AVAudioPlayerDelegate {
	
	// ─────────── Singleton ───────────
	static let shared = TextToSpeechService()
	
	// ─────────── Public State ───────────
	var selectedVoice: String = "shimmer"
	var onAudioFinished: (() -> Void)?
	var postClipFinished: ((Int) -> Void)?
	
	var currentTotalDuration: Double { totalDuration() }
	
	// ─────────── Private State ───────────
	private let summarizer = CardsSummarizer()
	private let ttsClient  = TTSAPIClient()
	
	var  audioPlayer : AVAudioPlayer?
	private var queuePlayer: AVQueuePlayer?
	private var persistAudioSession = false
	private var currentTopicName = "News"
	private var currentArtwork   : UIImage?
	private var expectingAppend  = false
	private var didNotifyFinish  = false
	
	// ─────────── Init ───────────
	private override init() {
		super.init()
		let saved = UserDefaults.standard.string(forKey: "voiceStyle") ?? "light"
		selectedVoice = TextToSpeechService.engineToken(for: saved)
	}
	
	// ─────────── Summarization / TTS ───────────
	func summarizeCards(cards: [Card], completion: @escaping (String?) -> Void) {
		print("[TTS] summarizeCards \(cards.count)")
		summarizer.summarizeCards(cards: cards, completion: completion)
	}
	
	func generateTTS(summary: String, completion: @escaping (URL?) -> Void) {
		print("[TTS] generateTTS \(summary.prefix(40))…")
		ttsClient.generateTTS(summary: summary, completion: completion)
	}
	
	// ─────────── Single-clip Playback ───────────
	func playAudio(
		url: URL,
		topicName: String,
		artwork: UIImage? = nil,
		delay: TimeInterval = 0,
		keepSessionActive: Bool = false
	) {
		didNotifyFinish = false
		setupSession(keepActive: keepSessionActive)
		currentTopicName = topicName
		currentArtwork   = artwork
		
		guard let player = try? AVAudioPlayer(contentsOf: url) else { return }
		audioPlayer = player
		audioPlayer?.delegate = self
		audioPlayer?.prepareToPlay()
		updateNowPlayingInfo()
		
		if delay > 0 {
			player.play(atTime: player.deviceCurrentTime + delay)
		} else {
			player.play()
		}
		setupRemoteControls()
	}
	
	// ─────────── Queue Playback ───────────
	func playAudioSequence(
		urls: [URL],
		topicName: String,
		artwork: UIImage? = nil,
		keepSessionActive: Bool = false,
		expectingAppend: Bool = false
	) {
		guard !urls.isEmpty else { return }
		self.expectingAppend = expectingAppend
		didNotifyFinish = false
		setupSession(keepActive: keepSessionActive)
		currentTopicName = topicName
		currentArtwork   = artwork
		
		let items = urls.enumerated().map { idx, url -> AVPlayerItem in
			let item = AVPlayerItem(url: url)
			NotificationCenter.default.addObserver(
				forName: .AVPlayerItemDidPlayToEndTime,
				object: item,
				queue: .main
			) { [weak self] _ in
				guard let self = self else { return }
				self.postClipFinished?(idx)
				self.checkForCompletion()
			}
			return item
		}
		
		queuePlayer = AVQueuePlayer(items: items)
		queuePlayer?.actionAtItemEnd = .advance
		if #available(iOS 10.0, *) {
			queuePlayer?.automaticallyWaitsToMinimizeStalling = false
		}
		
		updateNowPlayingInfo()
		queuePlayer?.play()
		setupRemoteControls()
	}
	
	// ─────────── Append Clip ───────────
	@discardableResult
	func appendToQueue(url: URL) -> AVPlayerItem? {
		guard let q = queuePlayer else { return nil }
		let item = AVPlayerItem(url: url)
		let idx  = q.items().count
		NotificationCenter.default.addObserver(
			forName: .AVPlayerItemDidPlayToEndTime,
			object: item,
			queue: .main
		) { [weak self] _ in
			guard let self = self else { return }
			self.postClipFinished?(idx)
			self.checkForCompletion()
		}
		q.insert(item, after: nil)
		if q.timeControlStatus == .paused { q.play() }
		return item
	}
	
	// ─────────── Mark appending finished ───────────
	func markAppendingComplete() {
		expectingAppend = false
		checkForCompletion()
	}
	
	// ─────────── Pause/Resume for widget previews ───────────
	func pauseQueue() {
		queuePlayer?.pause()
		persistAudioSession = true
	}
	
	func resumeQueue() {
		if let q = queuePlayer, !q.items().isEmpty {
			q.play()
		}
	}
	
	// ─────────── Preview Playback ───────────
	func playPreview(from url: URL) {
		let s = AVAudioSession.sharedInstance()
		try? s.setCategory(.ambient, mode: .default, options: [.duckOthers])
		try? s.setActive(true)
		didNotifyFinish = false
		audioPlayer = try? AVAudioPlayer(contentsOf: url)
		audioPlayer?.delegate = self
		audioPlayer?.play()
	}
	
	// ─────────── Session / Remote / Now-Playing ───────────
	private func setupSession(keepActive: Bool) {
		persistAudioSession = keepActive
		let s = AVAudioSession.sharedInstance()
		try? s.setActive(false, options: .notifyOthersOnDeactivation)
		try? s.setCategory(.playback, mode: .default, options: [.allowAirPlay])
		try? s.setActive(true)
	}
	
	var currentPlaybackTime: Double {
		queuePlayer?.currentTime().seconds ?? audioPlayer?.currentTime ?? 0
	}
	
	private func totalDuration() -> Double {
		if let q = queuePlayer {
			return q.items()
				.compactMap { $0.asset.duration.isIndefinite ? nil : $0.asset.duration.seconds }
				.reduce(0, +)
		}
		return audioPlayer?.duration ?? 0
	}
	
	private func updateNowPlayingInfo() {
		var info: [String: Any] = [
			MPMediaItemPropertyTitle: "\(currentTopicName) News Briefing",
			MPMediaItemPropertyArtist: "Ponder",
			MPMediaItemPropertyPlaybackDuration: totalDuration(),
			MPNowPlayingInfoPropertyElapsedPlaybackTime: currentPlaybackTime,
			MPNowPlayingInfoPropertyPlaybackRate: 1
		]
		if let img = currentArtwork {
			info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
		}
		MPNowPlayingInfoCenter.default().nowPlayingInfo = info
	}
	
	func updateNowPlayingArtwork(_ image: UIImage) {
		var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
		let art  = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
		info[MPMediaItemPropertyArtwork] = art
		MPNowPlayingInfoCenter.default().nowPlayingInfo = info
	}
	
	private func setupRemoteControls() {
		let cc = MPRemoteCommandCenter.shared()
		cc.playCommand.removeTarget(nil)
		cc.pauseCommand.removeTarget(nil)
		cc.togglePlayPauseCommand.removeTarget(nil)
		
		cc.playCommand.isEnabled  = true
		cc.pauseCommand.isEnabled = true
		cc.togglePlayPauseCommand.isEnabled = true
		
		cc.playCommand.addTarget  { [weak self] _ in self?.queuePlayer?.play();  return .success }
		cc.pauseCommand.addTarget { [weak self] _ in self?.queuePlayer?.pause(); return .success }
		cc.togglePlayPauseCommand.addTarget { [weak self] _ in
			guard let self = self else { return .commandFailed }
			if self.queuePlayer?.timeControlStatus == .paused {
				self.queuePlayer?.play()
			} else {
				self.queuePlayer?.pause()
			}
			return .success
		}
	}
	
	// ─────────── Stop / Completion ───────────
	func stopAudio(shouldDeactivate: Bool = true) {
		queuePlayer?.pause()
		queuePlayer?.removeAllItems()
		queuePlayer = nil
		audioPlayer?.stop()
		audioPlayer = nil
		expectingAppend = false
		
		if shouldDeactivate && !persistAudioSession {
			try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
			MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
		}
		if shouldDeactivate { persistAudioSession = false }
	}
	
	private func checkForCompletion() {
		DispatchQueue.main.async { [weak self] in
			guard let self = self else { return }
			let empty = self.queuePlayer?.items().isEmpty ?? true
			if empty && !self.expectingAppend {
				self.stopAudio(shouldDeactivate: !self.persistAudioSession)
				self.notifyFinishedIfNeeded()
			}
		}
	}
	
	func audioPlayerDidFinishPlaying(_: AVAudioPlayer, successfully _: Bool) {
		stopAudio(shouldDeactivate: !persistAudioSession)
		notifyFinishedIfNeeded()
	}
	
	// ─────────── Section Header ───────────
	// Finish notification guard
	private func notifyFinishedIfNeeded() {
		guard !didNotifyFinish else { return }
		didNotifyFinish = true
		onAudioFinished?()
	}
	
	// ─────────── Section Header ───────────
	// Voice mapping utils
	private static func engineToken(for raw: String) -> String {
		let s = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
		if s == "deep" || s == "echo" { return "echo" }
		return "shimmer"
	}
}
