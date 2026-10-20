package dev.trydex.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import dev.trydex.core.client.DexSession
import dev.trydex.core.model.DexJson
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Where the signed-in session is kept. */
interface SessionStore {
    fun load(): DexSession?
    fun save(session: DexSession)
    fun clear()
}

/**
 * Keeps the session encrypted with an AES-GCM key in the Android Keystore: the key never leaves the device's secure
 * hardware, and the token is excluded from backups (data_extraction_rules.xml).
 */
class KeystoreSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("dex-session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    override fun load(): DexSession? = runCatching {
        val sealed = prefs.getString(SESSION, null) ?: return null
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        val json = cipher.doFinal(bytes.copyOfRange(12, bytes.size)).decodeToString()
        DexJson.decodeFromString(DexSession.serializer(), json)
    }.getOrElse {
        // A key lost with a restore, or a corrupt record: sign in again.
        clear()
        null
    }

    override fun save(session: DexSession) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(DexJson.encodeToString(DexSession.serializer(), session).encodeToByteArray())
        prefs.edit { putString(SESSION, Base64.encodeToString(sealed, Base64.NO_WRAP)) }
    }

    override fun clear() {
        prefs.edit { remove(SESSION) }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "dex-session"
        const val SESSION = "session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}

/** For tests and previews. */
class MemorySessionStore(private var session: DexSession? = null) : SessionStore {
    override fun load() = session
    override fun save(session: DexSession) {
        this.session = session
    }
    override fun clear() {
        session = null
    }
}
