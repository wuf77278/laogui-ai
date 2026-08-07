package cn.laogui.ai.mobile;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void applyDarkSystemBars() {
        getWindow().setStatusBarColor(Color.rgb(11, 13, 19));
        getWindow().setNavigationBarColor(Color.rgb(11, 13, 19));
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(decorView.getSystemUiVisibility()
                & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decorView);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LaoguiNativePlugin.class);
        super.onCreate(savedInstanceState);
        applyDarkSystemBars();
    }
}
