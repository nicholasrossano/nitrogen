import Foundation

// ─────────── DailyUsageLimiter ───────────
enum DailyUsageKey: String {
	case audioSummaries   = "daily_audioSummaries"
	case curatorExchanges = "daily_curatorExchanges"
}

struct DailyUsageLimiter {
	// ─────────── UTC day stamp helpers ───────────
	private static let df: DateFormatter = {
		let f = DateFormatter()
		f.calendar = Calendar(identifier: .iso8601)
		f.locale   = Locale(identifier: "en_US_POSIX")
		f.timeZone = TimeZone(secondsFromGMT: 0)          // ← always UTC
		f.dateFormat = "yyyyMMdd"                         // e.g. 20250722
		return f
	}()
	private static func todayKey(for base: DailyUsageKey) -> String {
		let day    = df.string(from: Date())
		return "\(base.rawValue)_\(day)"
	}
	
	// ─────────── Public API ───────────
	static func currentCount(for key: DailyUsageKey) -> Int {
		UserDefaults.standard.integer(forKey: todayKey(for: key))
	}
	
	static func increment(_ key: DailyUsageKey, by amount: Int = 1) {
		let k = todayKey(for: key)
		UserDefaults.standard.set(currentCount(for: key) + amount, forKey: k)
	}
	
	static func isLimitReached(for key: DailyUsageKey, limit: Int) -> Bool {
		// Admins & testers are exempt
		let role = FeatureFlagsManager.shared.currentUserRole
		if role == "admin" { return false }
		return currentCount(for: key) >= limit
	}
}
