import SwiftUI
import AVKit
import AVFoundation

struct LoopingVideoPlayer: UIViewRepresentable {
    var videoName: String
    var videoType: String

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        let url = Bundle.main.url(forResource: videoName, withExtension: videoType)!

        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [])

        let player = AVPlayer(url: url)
        player.isMuted = true
        player.play()

        let playerLayer = AVPlayerLayer(player: player)
        playerLayer.videoGravity = .resizeAspectFill
        playerLayer.frame = UIScreen.main.bounds
        view.layer.addSublayer(playerLayer)

        NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: player.currentItem, queue: .main) { _ in
            player.seek(to: .zero)
            player.play()
        }

        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
