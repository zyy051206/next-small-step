package io.github.zyy051206.nextstep;

import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.IOException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/** Release fixtures exercise the same parser as the real native network request. */
@RunWith(AndroidJUnit4.class)
public final class UpdateMetadataTest {
    private JSONObject release(String version) throws Exception {
        String name = "next-small-step-" + version + ".apk";
        JSONObject asset = new JSONObject()
                .put("name", name).put("state", "uploaded").put("size", 962592)
                .put("digest", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                .put("browser_download_url", "https://github.com/zyy051206/next-small-step/releases/download/v" + version + "/" + name);
        return new JSONObject().put("draft", false).put("prerelease", false)
                .put("tag_name", "v" + version).put("body", "修复问题并改进界面")
                .put("assets", new JSONArray().put(asset));
    }

    private void rejects(JSONObject json) throws Exception {
        try {
            AppUpdater.parseRelease(json, "2.0.2");
            fail("Unsafe or incomplete release was accepted");
        } catch (IOException expected) { /* The metadata cannot enable a download. */ }
    }

    @Test public void comparesNumericVersionsAndRejectsAmbiguousVersions() throws Exception {
        assertTrue(AppUpdater.compareVersions("2.10.0", "2.9.99") > 0);
        assertTrue(AppUpdater.compareVersions("3.0.0", "2.99.99") > 0);
        assertEquals(0, AppUpdater.compareVersions("2.0.2", "2.0.2"));
        assertTrue(AppUpdater.compareVersions("2.0.1", "2.0.2") < 0);
        for (String invalid : new String[]{"2.0", "2.0.3-beta", "02.0.3", "2.0.1000000000", "v2.0.3", "2.0.3\n"}) {
            try { AppUpdater.compareVersions(invalid, "2.0.2"); fail("Accepted " + invalid); }
            catch (IOException expected) { /* Only bounded stable versions are allowed. */ }
        }
    }

    @Test public void selectsCanonicalApkAndKeepsCurrentOrOlderVersionUninstallable() throws Exception {
        AppUpdater.Release newer = AppUpdater.parseRelease(release("2.1.0"), "2.0.2");
        assertTrue(newer.available);
        assertEquals("2.1.0", newer.version);
        assertEquals("https://github.com/zyy051206/next-small-step/releases/download/v2.1.0/next-small-step-2.1.0.apk", newer.url);
        assertEquals(962592, newer.size);
        assertEquals("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", newer.sha256);
        assertEquals("修复问题并改进界面", newer.notes);
        for (String version : new String[]{"2.0.1", "2.0.2"}) {
            AppUpdater.Release current = AppUpdater.parseRelease(release(version), "2.0.2");
            assertFalse(current.available);
            assertNull(current.url);
        }
    }

    @Test public void rejectsDraftsPrereleasesAndMissingOrDuplicateArtifacts() throws Exception {
        rejects(release("2.0.3").put("draft", true));
        rejects(release("2.0.3").put("prerelease", true));
        rejects(release("2.0.3").put("tag_name", "2.0.3"));
        rejects(release("2.0.3").put("assets", new JSONArray()));
        JSONObject duplicate = release("2.0.3");
        JSONArray assets = duplicate.getJSONArray("assets");
        assets.put(assets.getJSONObject(0));
        rejects(duplicate);
        JSONObject unfinished = release("2.0.3");
        unfinished.getJSONArray("assets").getJSONObject(0).put("state", "new");
        rejects(unfinished);
        for (long size : new long[]{0, -1, 1024L * 1024 * 1024 + 1}) {
            JSONObject invalidSize = release("2.0.3");
            invalidSize.getJSONArray("assets").getJSONObject(0).put("size", size);
            rejects(invalidSize);
        }
    }

    @Test public void rejectsExternalUrlsAndPathOrQueryTricks() throws Exception {
        String canonical = "https://github.com/zyy051206/next-small-step/releases/download/v2.0.3/next-small-step-2.0.3.apk";
        for (String bad : new String[]{
                canonical.replace("https:", "http:"),
                canonical.replace("github.com/", "github.com.evil.example/"),
                canonical.replace("github.com/", "github.com@evil.example/"),
                canonical.replace("zyy051206", "another-owner"),
                canonical.replace("v2.0.3/", "v2.0.4/"),
                canonical + "?redirect=https://evil.example", canonical + "#fragment",
                canonical.replace("github.com/", "github.com:443/"),
                "file:///sdcard/next-small-step-2.0.3.apk"}) {
            JSONObject invalid = release("2.0.3");
            invalid.getJSONArray("assets").getJSONObject(0).put("browser_download_url", bad);
            rejects(invalid);
        }
    }

    @Test public void limitsReleaseNotesAndTreatsThemAsText() throws Exception {
        String literal = "</script><img src=x onerror=alert(1)>";
        assertEquals(literal, AppUpdater.parseRelease(release("2.0.3").put("body", literal), "2.0.2").notes);
        StringBuilder longNotes = new StringBuilder();
        for (int i = 0; i < 7000; i++) longNotes.append('a');
        assertEquals(6000, AppUpdater.parseRelease(release("2.0.3").put("body", longNotes.toString()), "2.0.2").notes.length());
    }

    @Test public void requiresGitHubSha256DigestBeforeEnablingDownload() throws Exception {
        for (Object digest : new Object[]{JSONObject.NULL, "", "md5:abcd", "sha256:abcd", "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}) {
            JSONObject invalid = release("2.0.3");
            invalid.getJSONArray("assets").getJSONObject(0).put("digest", digest);
            rejects(invalid);
        }
        JSONObject missing = release("2.0.3");
        missing.getJSONArray("assets").getJSONObject(0).remove("digest");
        rejects(missing);
    }
}
