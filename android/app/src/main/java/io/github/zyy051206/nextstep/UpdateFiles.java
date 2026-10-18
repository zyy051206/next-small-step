package io.github.zyy051206.nextstep;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;

/** Bounded file validation shared by downloads, restored cache, and installation. */
final class UpdateFiles {
    static final long MAX_APK_BYTES = 512L * 1024 * 1024;

    static boolean allowedDownloadUrl(URL url) {
        String host = url.getHost();
        return "https".equals(url.getProtocol()) && url.getUserInfo() == null && url.getRef() == null
                && (url.getPort() == -1 || url.getPort() == 443)
                && ("github.com".equals(host) || "release-assets.githubusercontent.com".equals(host)
                || "objects.githubusercontent.com".equals(host) || "api.github.com".equals(host));
    }

    static MessageDigest sha256() throws IOException {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException error) { throw new IOException("SHA-256 unavailable"); }
    }

    static String hex(byte[] bytes) {
        char[] alphabet = "0123456789abcdef".toCharArray();
        char[] result = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            result[i * 2] = alphabet[(bytes[i] & 255) >>> 4];
            result[i * 2 + 1] = alphabet[bytes[i] & 15];
        }
        return new String(result);
    }

    static long copyVerified(InputStream input, OutputStream output, long expectedSize, String expectedHash,
                             BooleanSupplier cancelled, LongConsumer progress) throws IOException {
        if (expectedSize <= 0 || expectedSize > MAX_APK_BYTES || expectedHash == null
                || !expectedHash.matches("[0-9a-f]{64}")) throw new IOException("Invalid expected file");
        MessageDigest digest = sha256();
        byte[] buffer = new byte[32768];
        long received = 0;
        int count;
        while (true) {
            if (cancelled.getAsBoolean()) throw new IOException("Cancelled");
            count = input.read(buffer);
            if (count == -1) break;
            if (cancelled.getAsBoolean()) throw new IOException("Cancelled");
            received += count;
            if (received > expectedSize) throw new IOException("Unexpected size");
            digest.update(buffer, 0, count);
            if (output != null) output.write(buffer, 0, count);
            progress.accept(received);
        }
        if (received != expectedSize || !expectedHash.equals(hex(digest.digest()))) throw new IOException("File integrity mismatch");
        return received;
    }

    static void verifyFile(File file, AppUpdater.Release release, BooleanSupplier cancelled) throws IOException {
        if (!file.isFile() || file.length() != release.size) throw new IOException("Missing or changed APK");
        try (FileInputStream input = new FileInputStream(file)) {
            copyVerified(input, null, release.size, release.sha256, cancelled, ignored -> { });
        }
    }

    @SuppressWarnings("deprecation")
    static void verifyPackage(Context context, File file, AppUpdater.Release release) throws IOException {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        try {
            PackageInfo installed = manager.getPackageInfo(context.getPackageName(), flags);
            if (archive == null) throw new IOException("Invalid APK");
            long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
            long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
            verifyIdentity(context.getPackageName(), archive.packageName, release.version, archive.versionName,
                    installedCode, archiveCode, signatures(installed), signatures(archive));
        } catch (PackageManager.NameNotFoundException error) { throw new IOException("Installed package missing"); }
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signatures(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
    }

    static void verifyIdentity(String installedName, String archiveName, String expectedVersion, String archiveVersion,
                               long installedCode, long archiveCode, Signature[] installed, Signature[] archive) throws IOException {
        if (!installedName.equals(archiveName) || !expectedVersion.equals(archiveVersion) || archiveCode <= installedCode
                || installed == null || archive == null || installed.length == 0 || installed.length != archive.length) {
            throw new IOException("Not an upgrade for this app");
        }
        String[] a = new String[installed.length];
        String[] b = new String[archive.length];
        for (int i = 0; i < a.length; i++) {
            a[i] = hex(sha256().digest(installed[i].toByteArray()));
            b[i] = hex(sha256().digest(archive[i].toByteArray()));
        }
        Arrays.sort(a);
        Arrays.sort(b);
        if (!Arrays.equals(a, b)) throw new IOException("Signing certificate changed");
    }

    static Intent installIntent(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".updates", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("下一小步更新", uri));
        return intent;
    }
}
