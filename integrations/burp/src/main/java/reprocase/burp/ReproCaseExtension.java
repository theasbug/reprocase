package reprocase.burp;

import burp.api.montoya.BurpExtension;
import burp.api.montoya.MontoyaApi;
import burp.api.montoya.http.message.HttpRequestResponse;
import burp.api.montoya.ui.contextmenu.ContextMenuEvent;
import burp.api.montoya.ui.contextmenu.ContextMenuItemsProvider;

import javax.swing.*;
import java.awt.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Adds "Send to ReproCase" to Burp's context menu. Selected requests (with responses when
 * available) are sent to the local ReproCase service as a Burp XML import, which creates a
 * reviewable case draft. The import never sends a request to the target.
 */
public final class ReproCaseExtension implements BurpExtension {
    private static final String PREF_SOURCE = "reprocase.connection";
    private static final Pattern LOOPBACK = Pattern.compile("^http://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d+)?$");
    private static final Pattern JSON_STRING = Pattern.compile("\"([A-Za-z]+)\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"");

    private MontoyaApi api;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private JTextField sourceField;
    private JLabel statusLabel;

    @Override
    public void initialize(MontoyaApi api) {
        this.api = api;
        api.extension().setName("ReproCase");
        api.userInterface().registerSuiteTab("ReproCase", buildTab());
        api.userInterface().registerContextMenuItemsProvider(new ContextMenuItemsProvider() {
            @Override
            public List<Component> provideMenuItems(ContextMenuEvent event) {
                List<HttpRequestResponse> items = new ArrayList<>(event.selectedRequestResponses());
                if (items.isEmpty()) event.messageEditorRequestResponse().ifPresent(e -> items.add(e.requestResponse()));
                if (items.isEmpty()) return List.of();
                JMenuItem item = new JMenuItem(items.size() == 1 ? "Send to ReproCase" : "Send " + items.size() + " requests to ReproCase");
                item.addActionListener(a -> new Thread(() -> send(items), "reprocase-send").start());
                return List.of(item);
            }
        });
        api.logging().logToOutput("ReproCase extension loaded. Configure the connection in the ReproCase tab.");
    }

    private Component buildTab() {
        JPanel panel = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(6, 12, 6, 12);
        c.anchor = GridBagConstraints.WEST;
        c.fill = GridBagConstraints.HORIZONTAL;
        c.gridx = 0; c.gridy = 0; c.gridwidth = 3;
        JLabel title = new JLabel("ReproCase connection");
        title.setFont(title.getFont().deriveFont(Font.BOLD, title.getFont().getSize() + 4f));
        panel.add(title, c);
        c.gridy++;
        panel.add(new JLabel("<html>Paste the launch URL printed by ReproCase (<code>http://localhost:4317/#token=...</code>),<br>"
                + "or choose its <code>runtime.json</code>: desktop app <code>ReproCase-data\\workspace\\runtime.json</code>,"
                + " source checkout <code>.reprocase\\runtime.json</code>.<br>A runtime.json path keeps working after ReproCase restarts.</html>"), c);
        c.gridy++; c.gridwidth = 1; c.weightx = 1;
        String saved = api.persistence().preferences().getString(PREF_SOURCE);
        sourceField = new JTextField(saved == null ? "" : saved, 48);
        panel.add(sourceField, c);
        c.gridx = 1; c.weightx = 0;
        JButton browse = new JButton("Browse…");
        browse.addActionListener(a -> {
            JFileChooser chooser = new JFileChooser();
            if (chooser.showOpenDialog(panel) == JFileChooser.APPROVE_OPTION) sourceField.setText(chooser.getSelectedFile().getAbsolutePath());
        });
        panel.add(browse, c);
        c.gridx = 2;
        JButton test = new JButton("Save and test");
        test.addActionListener(a -> {
            String value = sourceField.getText().trim();
            new Thread(() -> saveAndTest(value), "reprocase-test").start();
        });
        panel.add(test, c);
        c.gridx = 0; c.gridy++; c.gridwidth = 3;
        statusLabel = new JLabel(" ");
        panel.add(statusLabel, c);
        c.gridy++;
        panel.add(new JLabel("<html><br>Right-click requests in Proxy history, Repeater or Logger → <b>Send to ReproCase</b>.<br>"
                + "The import creates a case draft for review. It does not send any request to the target.<br>"
                + "Session credentials in captured headers are not copied into the case. Bind your test accounts inside ReproCase.</html>"), c);
        JPanel outer = new JPanel(new BorderLayout());
        outer.add(panel, BorderLayout.NORTH);
        return outer;
    }

    private void saveAndTest(String source) {
        api.persistence().preferences().setString(PREF_SOURCE, source);
        try {
            Connection conn = connection(source);
            HttpResponse<String> r = client.send(HttpRequest.newBuilder(URI.create(conn.origin() + "/api/state"))
                    .header("Authorization", "Bearer " + conn.token()).timeout(Duration.ofSeconds(10)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() == 200) status("Connected to " + conn.origin(), true);
            else status("ReproCase answered HTTP " + r.statusCode() + ". Paste a current launch URL or use runtime.json.", false);
        } catch (Exception e) {
            status("Not connected: " + message(e), false);
        }
    }

    private void send(List<HttpRequestResponse> items) {
        try {
            Connection conn = connection(api.persistence().preferences().getString(PREF_SOURCE));
            String payload = "{\"kind\":\"burp\",\"data\":" + jsonString(toBurpXml(items)) + "}";
            HttpResponse<String> r = client.send(HttpRequest.newBuilder(URI.create(conn.origin() + "/api/import"))
                    .header("Authorization", "Bearer " + conn.token())
                    .header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(30))
                    .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)).build(),
                    HttpResponse.BodyHandlers.ofString());
            if (r.statusCode() != 200) throw new IllegalStateException("ReproCase answered HTTP " + r.statusCode() + ": " + abbreviate(field(r.body(), "error")));
            String caseTitle = field(r.body(), "title");
            String done = "Created a ReproCase draft" + (caseTitle == null ? "" : ": " + caseTitle) + ". Review it in ReproCase.";
            api.logging().logToOutput(done);
            status(done, true);
        } catch (Exception e) {
            String why = message(e);
            api.logging().logToError("ReproCase import failed: " + why);
            status("Import failed: " + why, false);
            SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(null, "ReproCase import failed:\n" + why, "ReproCase", JOptionPane.WARNING_MESSAGE));
        }
    }

    /** Serializes the selection in the Burp XML export format accepted by ReproCase's "burp" importer. */
    static String toBurpXml(List<HttpRequestResponse> items) {
        StringBuilder xml = new StringBuilder("<?xml version=\"1.0\"?>\n<items>\n");
        Base64.Encoder b64 = Base64.getEncoder();
        for (HttpRequestResponse item : items) {
            if (item == null || item.request() == null) continue;
            xml.append("  <item>\n    <url>").append(escapeXml(item.request().url())).append("</url>\n");
            xml.append("    <request base64=\"true\">").append(b64.encodeToString(item.request().toByteArray().getBytes())).append("</request>\n");
            if (item.hasResponse()) xml.append("    <response base64=\"true\">").append(b64.encodeToString(item.response().toByteArray().getBytes())).append("</response>\n");
            xml.append("  </item>\n");
        }
        return xml.append("</items>\n").toString();
    }

    /** Resolves the service address and token from a launch URL, a runtime.json file or its folder. */
    static Connection connection(String source) throws Exception {
        if (source == null || source.isBlank()) throw new IllegalStateException("Open the ReproCase tab and paste the launch URL or runtime.json path.");
        String origin, token;
        int hash = source.indexOf("#token=");
        if (source.startsWith("http") && hash > 0) {
            origin = source.substring(0, hash).replaceAll("/+$", "");
            token = source.substring(hash + 7).trim();
        } else {
            Path path = Path.of(source);
            if (Files.isDirectory(path)) path = path.resolve("runtime.json");
            if (!Files.exists(path)) throw new IllegalStateException("No runtime.json at " + path + ". Is ReproCase running?");
            String json = Files.readString(path, StandardCharsets.UTF_8);
            origin = field(json, "origin");
            token = field(json, "token");
        }
        if (origin == null || token == null || token.isBlank()) throw new IllegalStateException("Could not read the ReproCase address and token.");
        if (!LOOPBACK.matcher(origin).matches()) throw new IllegalStateException("Refusing to send captures to a non-loopback address: " + origin);
        return new Connection(origin, token);
    }

    private void status(String text, boolean ok) {
        SwingUtilities.invokeLater(() -> {
            if (statusLabel == null) return;
            statusLabel.setText(text);
            statusLabel.setForeground(ok ? new Color(0x2e9e78) : new Color(0xc0392b));
        });
    }

    /** Minimal reader for flat string fields; avoids bundling a JSON library into Burp. */
    static String field(String json, String name) {
        if (json == null) return null;
        Matcher m = JSON_STRING.matcher(json);
        while (m.find()) if (m.group(1).equals(name)) return m.group(2).replace("\\\"", "\"").replace("\\\\", "\\");
        return null;
    }

    static String jsonString(String s) {
        StringBuilder out = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> { if (ch < 0x20) out.append(String.format("\\u%04x", (int) ch)); else out.append(ch); }
            }
        }
        return out.append('"').toString();
    }

    static String escapeXml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String message(Exception e) { return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage(); }

    private static String abbreviate(String s) { return s == null ? "" : s.length() > 300 ? s.substring(0, 300) + "…" : s; }

    record Connection(String origin, String token) {}
}
