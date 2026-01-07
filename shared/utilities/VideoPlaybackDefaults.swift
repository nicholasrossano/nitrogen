import Foundation
import Combine
import FirebaseAuth

enum VideoPlaybackDefaults {
	static let firestoreAutoplayField = "videoAutoplayEnabled"
	static let userDefaultsAutoplayKeyPrefix = "video_autoplay_enabled"
	
	static func autoplayUserDefaultsKey(userId: String?) -> String {
		guard let userId, !userId.isEmpty else { return userDefaultsAutoplayKeyPrefix }
		return "\(userDefaultsAutoplayKeyPrefix)_\(userId)"
	}
	
	static func loadAutoplayEnabled(userId: String? = Auth.auth().currentUser?.uid) -> Bool {
		guard FeatureFlagsManager.shared.isAutoplayEnabled else { return false }
		let key = autoplayUserDefaultsKey(userId: userId)
		guard UserDefaults.standard.object(forKey: key) != nil else { return true }
		return UserDefaults.standard.bool(forKey: key)
	}
	
	static func saveAutoplayEnabled(_ enabled: Bool, userId: String? = Auth.auth().currentUser?.uid) {
		guard FeatureFlagsManager.shared.isAutoplayEnabled else { return }
		let key = autoplayUserDefaultsKey(userId: userId)
		UserDefaults.standard.set(enabled, forKey: key)
	}
}

final class VideoSessionAudioState: ObservableObject {
	static let shared = VideoSessionAudioState()
	@Published var isAudioEnabled: Bool = false
	private var isUserOverride = false
	private init() { }
	
	func applyDefaultAudioState(shouldMuteByDefault: Bool) {
		guard !isUserOverride else { return }
		isAudioEnabled = !shouldMuteByDefault
	}
	
	func setAudioEnabledFromUser(_ enabled: Bool) {
		isUserOverride = true
		isAudioEnabled = enabled
	}
}
