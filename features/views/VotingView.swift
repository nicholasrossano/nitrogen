import SwiftUI
import Combine

struct VotingView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = VotingViewModel()
    @State private var showRequestFeatureView = false
    @State private var isRequestButtonVisible = true
    @State private var dragOffset: CGFloat = 0

    var body: some View {
        NavigationStack {
            ZStack {
                VStack {
                    if viewModel.isLoading {
                        GlobalLoadingIndicator()
                    } else {
                        VStack {
                            VStack {
                                Text("Vote on your favorite features and the team will prioritize building those out next.")
                                    .padding()
                                    .frame(maxWidth: .infinity, alignment: .center)
                                    .font(.custom("Avenir", size: 16))
                                    .multilineTextAlignment(.center)
                            }

                            List {
                                ForEach(viewModel.features, id: \.id) { feature in
                                    HStack {
                                        VStack(alignment: .leading, spacing: 5) {
                                            Text(feature.title)
                                                .font(.custom("Avenir-Medium", size: 16))
                                                .padding(.bottom, 2)

                                            Text(feature.description)
                                                .font(.custom("Avenir", size: 14))
                                                .foregroundColor(.gray)
                                        }
                                        Spacer()
                                        VoteButton(
                                            isVoted: viewModel.hasVoted(featureId: feature.id ?? ""),
                                            voteCount: viewModel.voteCounts[feature.id ?? ""] ?? 0,
                                            onVote: {
                                                viewModel.voteForFeature(featureId: feature.id ?? "")
                                            }
                                        )
                                    }
                                    .padding(.vertical, 8)
                                }
                            }
                            .listStyle(PlainListStyle())
                            .transition(.slide)
                        }
                        .animation(.easeInOut, value: viewModel.features)
                    }
                }
                .onAppear {
                    viewModel.loadData()
                }

                // Pop-up to request a new feature
                if showRequestFeatureView {
                    RequestFeaturePopup(isPresented: $showRequestFeatureView, viewModel: viewModel)
                        .transition(.opacity)
                        .zIndex(1)
                }

                // Button to open the request form
                VStack {
                    Spacer()
                    HStack {
                        RequestFeatureButton(action: {
                            withAnimation(.easeInOut(duration: 0.3)) {
                                showRequestFeatureView = true
                                isRequestButtonVisible = false
                            }
                        }, isVisible: $isRequestButtonVisible)
                        .padding()
                        Spacer()
                    }
                }
                .zIndex(2)
            }
            .animation(.easeInOut(duration: 0.3), value: showRequestFeatureView)
            .onChange(of: showRequestFeatureView) { _, newValue in
                if !newValue {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            isRequestButtonVisible = true
                        }
                    }
                }
            }
            .customNavigation(title: "Voting")
            .navigationBarBackButtonHidden(true)
            .swipeBack()
            .navigationDestination(for: Int.self) { _ in
                EmptyView()
            }
        }
    }
}


struct VotingView_Previews: PreviewProvider {
    static var previews: some View {
        VotingView()
    }
}
