package cn.laogui.ai.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LaoguiNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
