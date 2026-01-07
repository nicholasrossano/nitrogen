protocol ServicesLocator {
	// ─────────── Core data & UI services ───────────
	var cardService: CardService { get }
	var visibilityNotifier: VisibilityNotifier { get }
	var votingService: VotingService { get }
	var userService: UserService { get }
	var featureService: FeatureService { get }
	var reportService: ReportService { get }
	var bookmarksService: BookmarksService { get }
	var notificationsService: NotificationsService { get }
	var userActivityService: UserActivityService { get }
	
	// ─────────── App-wide managers ───────────
	var locationService: LocationService { get }
	var featureFlagsManager: FeatureFlagsManager { get }
	var subscriptionStatus: SubscriptionStatus { get }
}
