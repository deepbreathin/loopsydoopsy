package app.loopsydoopsy;

import android.media.AudioManager;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Don't let the screen sleep mid-take.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Volume buttons control the music, not the ringer.
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        // Let the audio engine start without waiting for an extra tap.
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
