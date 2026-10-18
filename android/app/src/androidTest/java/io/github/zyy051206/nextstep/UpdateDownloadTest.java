package io.github.zyy051206.nextstep;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.content.pm.Signature;
import androidx.core.content.FileProvider;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.Assert.*;

/** Validates the actual stream/file/installer helpers without installing on a user's phone. */
@RunWith(AndroidJUnit4.class)
public final class UpdateDownloadTest {
    interface Checked { void run() throws Exception; }
    private void rejects(Checked task) throws Exception {
        try { task.run(); fail("Unsafe update accepted"); }
        catch (IOException expected) { }
    }
    private String hash(byte[] bytes) throws Exception { return UpdateFiles.hex(UpdateFiles.sha256().digest(bytes)); }

    @Test public void streamedDownloadRequiresExactBytesHashAndLength() throws Exception {
        byte[] bytes = "verified update bytes".getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        AtomicLong progress = new AtomicLong();
        assertEquals(bytes.length, UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), output, bytes.length, hash(bytes), () -> false, progress::set));
        assertArrayEquals(bytes, output.toByteArray());
        assertEquals(bytes.length, progress.get());
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), null, bytes.length + 1, hash(bytes), () -> false, n -> { }));
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), null, bytes.length - 1, hash(bytes), () -> false, n -> { }));
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), null, bytes.length, hash(new byte[]{1}), () -> false, n -> { }));
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), null, UpdateFiles.MAX_APK_BYTES + 1, hash(bytes), () -> false, n -> { }));
    }

    @Test public void cancellationStopsBeforeWritingTheRemainder() throws Exception {
        byte[] bytes = new byte[100000];
        AtomicBoolean cancelled = new AtomicBoolean();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), output, bytes.length, hash(bytes), cancelled::get, n -> cancelled.set(true)));
        assertTrue(output.size() > 0 && output.size() < bytes.length);
        ByteArrayOutputStream untouched = new ByteArrayOutputStream();
        rejects(() -> UpdateFiles.copyVerified(new ByteArrayInputStream(bytes), untouched, bytes.length, hash(bytes), () -> true, n -> { }));
        assertEquals(0, untouched.size());
    }

    @Test public void onlyExplicitGithubHttpsRedirectHostsAreAccepted() throws Exception {
        for (String host : new String[]{"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "api.github.com"}) {
            assertTrue(UpdateFiles.allowedDownloadUrl(new URL("https://" + host + "/file?signature=example")));
        }
        for (String bad : new String[]{"http://github.com/file", "https://github.com.evil.example/file", "https://user@github.com/file", "https://github.com:8443/file", "https://github.com/file#fragment", "https://127.0.0.1/file", "file:///sdcard/a.apk"}) {
            assertFalse(bad, UpdateFiles.allowedDownloadUrl(new URL(bad)));
        }
    }

    @Test public void packageAndSignerMustMatchAndVersionMustIncrease() throws Exception {
        Signature[] original = {new Signature(new byte[]{1, 2, 3})};
        Signature[] other = {new Signature(new byte[]{4, 5, 6})};
        UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.4", 5, 6, original, original);
        rejects(() -> UpdateFiles.verifyIdentity("app", "other", "2.0.4", "2.0.4", 5, 6, original, original));
        rejects(() -> UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.5", 5, 6, original, original));
        rejects(() -> UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.4", 5, 5, original, original));
        rejects(() -> UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.4", 5, 4, original, original));
        rejects(() -> UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.4", 5, 6, original, other));
        rejects(() -> UpdateFiles.verifyIdentity("app", "app", "2.0.4", "2.0.4", 5, 6, null, original));
    }

    @Test public void cachedBytesAreRecheckedBeforeInstallation() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        File file = new File(context.getCacheDir(), "update-validation-test.apk");
        byte[] bytes = "trusted".getBytes(StandardCharsets.UTF_8);
        AppUpdater.Release release = new AppUpdater.Release("2.0.4", "", "", bytes.length, hash(bytes), true);
        try {
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
            UpdateFiles.verifyFile(file, release, () -> false);
            try (FileOutputStream output = new FileOutputStream(file)) { output.write("changed".getBytes(StandardCharsets.UTF_8)); }
            rejects(() -> UpdateFiles.verifyFile(file, release, () -> false));
            // A matching hash alone is insufficient: the bytes must also be an authentic APK.
            try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
            rejects(() -> UpdateFiles.verifyPackage(context, file, release));
        } finally { file.delete(); }
    }

    @Test public void installerUsesPrivateContentUriAndReadOnlyGrant() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        File file = new File(context.getCacheDir(), "updates/install/next-small-step.apk");
        Intent intent = UpdateFiles.installIntent(context, file);
        assertEquals(Intent.ACTION_VIEW, intent.getAction());
        assertEquals("application/vnd.android.package-archive", intent.getType());
        assertEquals("content", intent.getData().getScheme());
        assertEquals(context.getPackageName() + ".updates", intent.getData().getAuthority());
        assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.getFlags());
        assertEquals(intent.getData(), intent.getClipData().getItemAt(0).getUri());
        ProviderInfo provider = context.getPackageManager().resolveContentProvider(context.getPackageName() + ".updates", 0);
        assertNotNull(provider);
        assertFalse(provider.exported);
        assertTrue(provider.grantUriPermissions);
        try {
            FileProvider.getUriForFile(context, context.getPackageName() + ".updates", new File(context.getFilesDir(), "user-data.json"));
            fail("User data became shareable through update provider");
        } catch (IllegalArgumentException expected) { }
        try {
            FileProvider.getUriForFile(context, context.getPackageName() + ".updates", new File(context.getCacheDir(), "updates/ready.json"));
            fail("Update metadata became shareable through update provider");
        } catch (IllegalArgumentException expected) { }
    }
}
