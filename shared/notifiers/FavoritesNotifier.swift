import Combine

class FavoritesNotifier: ObservableObject {
    @Published var favoriteTopicIds: [String] = []
    private var cancellables = Set<AnyCancellable>()
    private let favoritesService: FavoritesService

    init(favoritesService: FavoritesService) {
        self.favoritesService = favoritesService
    }

    func fetchFavorites() {
        favoritesService.fetchFavorites()
            .sink(receiveCompletion: { completion in
                if case .failure(let error) = completion {
                    print("Failed to fetch favorites: \(error)")
                }
            }, receiveValue: { [weak self] favorites in
                self?.favoriteTopicIds = favorites
            })
            .store(in: &cancellables)
    }

    func toggleFavorite(topicId: String) {
        favoritesService.toggleFavorite(topicId: topicId)
            .sink(receiveCompletion: { completion in
                if case .failure(let error) = completion {
                    print("Failed to toggle favorite: \(error)")
                }
            }, receiveValue: { [weak self] in
                self?.fetchFavorites()
            })
            .store(in: &cancellables)
    }
}
