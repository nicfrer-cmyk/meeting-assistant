package il.co.yarin.meetings;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeetingRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
