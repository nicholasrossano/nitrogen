import Foundation
import AVFoundation
import MediaPlayer
import UIKit

final class SystemAudioCenter: NSObject, ObservableObject {
	static let shared = SystemAudioCenter()
	private override init() {
		super.init()
		NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)), name: AVAudioSession.interruptionNotification, object: nil)
		NotificationCenter.default.addObserver(self, selector: #selector(handleRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
	}
	
	enum MediaKind { case music, podcast }
	
	struct PlayRequest: Equatable {
		let id: UUID
		let url: URL
		let title: String
		let artist: String
		let artworkURL: URL?
		let kind: MediaKind
		let clipStart: Double?
		let clipDuration: Double?
	}
	
	@Published private(set) var isPlaying: Bool = false
	@Published private(set) var elapsedSeconds: Double = 0
	@Published private(set) var durationSeconds: Double = 0
	@Published private(set) var activeRequestId: UUID?
	
	private var player: AVPlayer?
	private var timeObserver: Any?
	private var boundaryObserver: Any?
	private var artworkImage: UIImage?
	private var currentArtworkURL: URL?
	private var current: PlayRequest?
	
	private func takeAudioSession(for kind: MediaKind) {
		let session = AVAudioSession.sharedInstance()
		try? session.setCategory(.playback, mode: kind == .podcast ? .spokenAudio : .default, options: [])
		try? session.setActive(true)
	}
	
	private func releaseAudioSession() {
		try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
	}
	
	func toggle(_ request: PlayRequest) {
		if activeRequestId == request.id, isPlaying {
			stop(reason: "stopped")
		} else {
			play(request)
		}
	}
	
	func play(_ request: PlayRequest) {
		stopInternal(reason: "replace")
		
		current = request
		activeRequestId = request.id
		takeAudioSession(for: request.kind)
		UIApplication.shared.beginReceivingRemoteControlEvents()
		
		let item = AVPlayerItem(url: request.url)
		player = AVPlayer(playerItem: item)
		
		if let st = request.clipStart, st > 0 {
			let t = CMTime(seconds: st, preferredTimescale: 600)
			player?.seek(to: t, toleranceBefore: .zero, toleranceAfter: .zero)
		}
		
		if let st = request.clipStart, let dur = request.clipDuration, dur > 0 {
			let end = st + dur
			let endTime = CMTime(seconds: end, preferredTimescale: 600)
			boundaryObserver = player?.addBoundaryTimeObserver(forTimes: [NSValue(time: endTime)], queue: .main) { [weak self] in
				self?.stop(reason: "highlight_end")
			}
		}
		
		if let p = player {
			timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] t in
				guard let self else { return }
				self.elapsedSeconds = t.seconds
				if let d = p.currentItem?.duration.seconds, d.isFinite, d > 0 {
					self.durationSeconds = d
				}
				self.pushNowPlaying(rate: self.isPlaying ? 1.0 : 0.0)
			}
		}
		
		NotificationCenter.default.addObserver(self, selector: #selector(handleEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: item)
		
		configureRemoteCommands(for: request)
		
		artworkImage = nil
		currentArtworkURL = request.artworkURL
		pushNowPlaying(rate: 1.0)
		preloadArtwork(url: request.artworkURL)
		
		player?.play()
		isPlaying = true
		
		if let d = player?.currentItem?.duration.seconds, d.isFinite, d > 0 {
			durationSeconds = d
		}
	}
	
	func pause() {
		guard isPlaying else { return }
		player?.pause()
		isPlaying = false
		pushNowPlaying(rate: 0.0)
	}
	
	func stop(reason: String = "stopped") {
		stopInternal(reason: reason)
		releaseAudioSession()
		UIApplication.shared.endReceivingRemoteControlEvents()
	}
	
	private func stopInternal(reason: String) {
		if let obs = boundaryObserver {
			player?.removeTimeObserver(obs)
			boundaryObserver = nil
		}
		if let obs = timeObserver {
			player?.removeTimeObserver(obs)
			timeObserver = nil
		}
		NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: player?.currentItem)
		
		player?.pause()
		player = nil
		
		isPlaying = false
		elapsedSeconds = 0
		durationSeconds = 0
		
		MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
		MPNowPlayingInfoCenter.default().playbackState = .stopped
		tearDownRemoteCommands()
		
		current = nil
		activeRequestId = nil
		artworkImage = nil
		currentArtworkURL = nil
	}
	
	private func pushNowPlaying(rate: Double) {
		guard let req = current else { return }
		var info: [String: Any] = [
			MPMediaItemPropertyTitle: req.title,
			MPMediaItemPropertyArtist: req.artist,
			MPNowPlayingInfoPropertyMediaType: NSNumber(value: MPNowPlayingInfoMediaType.audio.rawValue),
			MPNowPlayingInfoPropertyElapsedPlaybackTime: elapsedSeconds,
			MPNowPlayingInfoPropertyPlaybackRate: rate,
			MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0
		]
		if durationSeconds > 0 {
			info[MPMediaItemPropertyPlaybackDuration] = durationSeconds
		}
		if req.kind == .podcast {
			info[MPMediaItemPropertyPodcastTitle] = req.title
		}
		info[MPNowPlayingInfoPropertyIsLiveStream] = NSNumber(value: false)
		info[MPNowPlayingInfoPropertyExternalContentIdentifier] = req.url.absoluteString
		
		if let art = artworkImage {
			info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: art.size) { _ in art }
		}
		
		MPNowPlayingInfoCenter.default().nowPlayingInfo = info
		MPNowPlayingInfoCenter.default().playbackState = rate > 0 ? .playing : .paused
	}
	
	private func preloadArtwork(url: URL?) {
		guard let url else { return }
		let target = url
		URLSession.shared.dataTask(with: target) { [weak self] data, _, _ in
			guard let self, let data, let img = UIImage(data: data) else { return }
			DispatchQueue.main.async {
				guard self.currentArtworkURL == target else { return }
				self.artworkImage = img
				self.pushNowPlaying(rate: self.isPlaying ? 1.0 : 0.0)
			}
		}.resume()
	}
	
	private func configureRemoteCommands(for request: PlayRequest) {
		let cc = MPRemoteCommandCenter.shared()
		tearDownRemoteCommands()
		
		cc.playCommand.isEnabled = true
		cc.pauseCommand.isEnabled = true
		cc.togglePlayPauseCommand.isEnabled = true
		cc.changePlaybackPositionCommand.isEnabled = true
		cc.skipForwardCommand.isEnabled = true
		cc.skipBackwardCommand.isEnabled = true
		
		let jump = request.kind == .podcast ? 15.0 : 10.0
		cc.skipForwardCommand.preferredIntervals = [NSNumber(value: jump)]
		cc.skipBackwardCommand.preferredIntervals = [NSNumber(value: jump)]
		
		cc.playCommand.addTarget { [weak self] _ in
			guard let self, let p = self.player else { return .commandFailed }
			if self.isPlaying { return .success }
			p.play()
			self.isPlaying = true
			self.pushNowPlaying(rate: 1.0)
			return .success
		}
		cc.pauseCommand.addTarget { [weak self] _ in
			guard let self else { return .commandFailed }
			self.pause()
			return .success
		}
		cc.togglePlayPauseCommand.addTarget { [weak self] _ in
			guard let self else { return .commandFailed }
			if self.isPlaying { self.pause() } else if let req = self.current { self.play(req) }
			return .success
		}
		cc.changePlaybackPositionCommand.addTarget { [weak self] event in
			guard let self,
				  let ev = event as? MPChangePlaybackPositionCommandEvent,
				  let p = self.player else { return .commandFailed }
			p.seek(to: CMTime(seconds: ev.positionTime, preferredTimescale: 600))
			self.elapsedSeconds = ev.positionTime
			self.pushNowPlaying(rate: self.isPlaying ? 1.0 : 0.0)
			return .success
		}
		cc.skipForwardCommand.addTarget { [weak self] _ in
			guard let self, let p = self.player else { return .commandFailed }
			let newTime = min(self.elapsedSeconds + jump, (self.durationSeconds > 0 ? self.durationSeconds : self.elapsedSeconds + jump))
			p.seek(to: CMTime(seconds: newTime, preferredTimescale: 600))
			self.elapsedSeconds = newTime
			self.pushNowPlaying(rate: self.isPlaying ? 1.0 : 0.0)
			return .success
		}
		cc.skipBackwardCommand.addTarget { [weak self] _ in
			guard let self, let p = self.player else { return .commandFailed }
			let newTime = max(self.elapsedSeconds - jump, 0)
			p.seek(to: CMTime(seconds: newTime, preferredTimescale: 600))
			self.elapsedSeconds = newTime
			self.pushNowPlaying(rate: self.isPlaying ? 1.0 : 0.0)
			return .success
		}
	}
	
	private func tearDownRemoteCommands() {
		let cc = MPRemoteCommandCenter.shared()
		cc.playCommand.removeTarget(nil)
		cc.pauseCommand.removeTarget(nil)
		cc.togglePlayPauseCommand.removeTarget(nil)
		cc.changePlaybackPositionCommand.removeTarget(nil)
		cc.skipForwardCommand.removeTarget(nil)
		cc.skipBackwardCommand.removeTarget(nil)
	}
	
	@objc private func handleEnded(_ note: Notification) {
		stop(reason: "ended")
	}
	
	@objc private func handleInterruption(_ note: Notification) {
		guard let info = note.userInfo,
			  let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
			  let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
		switch type {
		case .began:
			pause()
		case .ended:
			if let optRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt,
			   AVAudioSession.InterruptionOptions(rawValue: optRaw).contains(.shouldResume) {
				player?.play()
				isPlaying = true
				pushNowPlaying(rate: 1.0)
			}
		@unknown default: break
		}
	}
	
	@objc private func handleRouteChange(_ note: Notification) {
		guard let info = note.userInfo,
			  let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
			  let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
		if reason == .oldDeviceUnavailable {
			pause()
		}
	}
}
