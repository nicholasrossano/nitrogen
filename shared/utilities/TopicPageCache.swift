import SwiftUI

/// A simple cache that remembers a UIHostingController for each topic ID
class TopicPageCache: ObservableObject {
    var controllersByTopicId: [String: UIHostingController<AnyView>] = [:]

    /// Return a hosting controller for this topic ID, creating one if needed.
    func controller(for topicId: String, buildView: @autoclosure () -> AnyView) -> UIHostingController<AnyView> {
        if let existing = controllersByTopicId[topicId] {
            return existing
        }
        let newController = UIHostingController(rootView: buildView())
        controllersByTopicId[topicId] = newController
        return newController
    }
}
