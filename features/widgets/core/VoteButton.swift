import SwiftUI

struct VoteButton: View {
    let isVoted: Bool
    let voteCount: Int
    let onVote: () -> Void
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        Button(action: {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onVote()
        }) {
            VStack(spacing: 2) {
                Image(systemName: isVoted ? "arrowtriangle.up.fill" : "arrowtriangle.up")
                    .foregroundColor(isVoted ? Color.accentPrimary : .secondary)
                Text("\(voteCount)")
                    .foregroundColor(.primary)
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isVoted ? Color.accentPrimary : .secondary, lineWidth: 1.5)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color(.systemBackground))
                    )
            )
        }
    }
}
