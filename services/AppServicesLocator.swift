import Combine
import FirebaseAuth
import FirebaseAnalytics
import FirebaseFunctions

class AppServicesLocator: ObservableObject, ServicesLocator {
	
	// MARK: – Singleton
	static let shared = AppServicesLocator()
	
	// MARK: – Core Firebase handle
	let functions: Functions
	
	// MARK: – Published services
	@Published var cardService          : CardService
	@Published var visibilityNotifier   : VisibilityNotifier
	@Published var votingService        : VotingService
	@Published var userService          : UserService
	@Published var featureService       : FeatureService
	@Published var reportService        : ReportService
	@Published var bookmarksService     : BookmarksService
	@Published var notificationsService : NotificationsService
	@Published var userActivityService  : UserActivityService
	@Published var locationService      : LocationService
	@Published var featureFlagsManager  : FeatureFlagsManager
	@Published var subscriptionStatus   : SubscriptionStatus
	@Published var searchManager        : SearchManager
	
	private var cancellables = Set<AnyCancellable>()
	
	// MARK: – Init
	private init() {
		
		// ─────────── Build core singletons first (no `self` yet) ───────────
		let functions     = Functions.functions(region: "us-east4")
		let userService   = UserService()
		let searchManager = SearchManager(userService: userService)
		
		// ─────────── Assign stored properties ───────────
		self.functions      = functions
		self.userService    = userService
		self.searchManager  = searchManager
		
		self.cardService          = CardService()
		self.visibilityNotifier   = VisibilityNotifier()
		self.votingService        = VotingService()
		self.featureService       = FeatureService()
		self.reportService        = ReportService()
		self.bookmarksService     = BookmarksService()
		self.notificationsService = NotificationsService()
		self.userActivityService  = UserActivityService()
		self.locationService      = LocationService()
		self.featureFlagsManager  = FeatureFlagsManager.shared
		self.subscriptionStatus   = SubscriptionStatus.shared
		
		// ─────────── GA4 must be ready before first event ───────────
		Analytics.setAnalyticsCollectionEnabled(true)
		if let id = userService.getUserId() { Analytics.setUserID(id) }
		userActivityService.configureForLaunch(appRole: nil, locale: Locale.current.identifier)
	}
	
	// MARK: – User-scoped bootstrap helpers
	func loginUser() {
		if let id = userService.getUserId() {
			Analytics.setUserID(id)
		}
		userService.refreshCurrentUser()
	}
}
