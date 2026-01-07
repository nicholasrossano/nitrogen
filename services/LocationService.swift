import CoreLocation
import Combine

// ─────────── LocationService ───────────
final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
	@Published private(set) var sessionLocation: CLLocation?
	private let manager = CLLocationManager()
	
	override init() {
		super.init()
		manager.delegate = self
		manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
	}
	
	func requestCurrent() {
		switch manager.authorizationStatus {
		case .notDetermined:
			manager.requestWhenInUseAuthorization()
		case .authorizedWhenInUse, .authorizedAlways:
			manager.requestLocation()
		default:
			break
		}
	}
	
	func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
		if let loc = locations.first { sessionLocation = loc }
	}
	
	func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
		print("Location error: \(error.localizedDescription)")
	}
}
