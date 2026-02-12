// src/outlook/auth.js
const axios = require('axios');

class OutlookAuth {
    constructor() {
        this.clientId = process.env.AZURE_CLIENT_ID;
        this.clientSecret = process.env.AZURE_CLIENT_SECRET;
        this.redirectUri = process.env.REDIRECT_URI;
        this.tenant = process.env.AZURE_TENANT_ID || 'consumers';
        this.scopes = [
            'Mail.ReadWrite',
            'Mail.Send',
            'MailboxSettings.ReadWrite',
            'offline_access',
            'User.Read'
        ];
    }

    getAuthUrl() {
        return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?` +
            `client_id=${this.clientId}&` +
            `response_type=code&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_mode=query&` +
            `scope=${encodeURIComponent(this.scopes.join(' '))}&` +
            `prompt=select_account`;
    }

    async getTokenFromCode(code) {
        try {
            console.log('📤 Getting token from code...');
            
            const tokenUrl = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
            
            const params = new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                code: code,
                redirect_uri: this.redirectUri,
                grant_type: 'authorization_code',
                scope: this.scopes.join(' ')
            });

            const response = await axios.post(tokenUrl, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            console.log('✅ Token received successfully');

            // Get user info from Graph API
            try {
                const userResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
                    headers: {
                        'Authorization': `Bearer ${response.data.access_token}`
                    }
                });

                return {
                    success: true,
                    accessToken: response.data.access_token,
                    refreshToken: response.data.refresh_token,
                    expiresIn: response.data.expires_in,
                    email: userResponse.data.mail || userResponse.data.userPrincipalName,
                    name: userResponse.data.displayName || userResponse.data.userPrincipalName
                };
            } catch (userError) {
                // Fallback to token decoding
                const tokenData = JSON.parse(
                    Buffer.from(response.data.access_token.split('.')[1], 'base64').toString()
                );
                
                return {
                    success: true,
                    accessToken: response.data.access_token,
                    refreshToken: response.data.refresh_token,
                    expiresIn: response.data.expires_in,
                    email: tokenData.email || tokenData.preferred_username || 'user@outlook.com',
                    name: tokenData.name || 'Outlook User'
                };
            }
        } catch (error) {
            console.error('❌ Token error:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error_description || error.message,
                errorCode: error.response?.data?.error,
                status: error.response?.status
            };
        }
    }

async refreshAccessToken(refreshToken, force = false) {
    try {
        
        const tokenUrl = `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
        
        const params = new URLSearchParams({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            scope: this.scopes.join(' ')
        });

        const response = await axios.post(tokenUrl, params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });


        return {
            success: true,
            accessToken: response.data.access_token,
            refreshToken: response.data.refresh_token || refreshToken,
            expiresIn: response.data.expires_in
        };
    } catch (error) {
        console.error('❌ Refresh error:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data?.error_description || error.message,
            errorCode: error.response?.data?.error,
            status: error.response?.status
        };
    }
}
}

module.exports = OutlookAuth;