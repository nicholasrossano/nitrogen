import UIKit

enum HomeImageSelector {
	static var selected: String? {
		if let cached = _cached { return cached }
		
		var found: [String] = []
		if UIImage(named: "Home") != nil { found.append("Home") }
		for i in 1...30 {
			let candidate = "Home\(i)"
			if UIImage(named: candidate) != nil { found.append(candidate) }
		}
		_cached = found.randomElement()
		return _cached
	}
	
	// MARK: – Private
	private static var _cached: String?
}
