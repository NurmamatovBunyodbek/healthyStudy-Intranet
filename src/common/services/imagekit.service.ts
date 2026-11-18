import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ImageKit from 'imagekit';

export interface ImageKitUploadAuthResponse {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
}

@Injectable()
export class ImageKitService {
  private client: ImageKit | null = null;
  private publicKey = '';
  private urlEndpoint = '';

  constructor(private readonly configService: ConfigService) {
    this.publicKey =
      this.configService.get<string>('imagekit.publicKey') || '';
    const privateKey =
      this.configService.get<string>('imagekit.privateKey') || '';
    this.urlEndpoint =
      this.configService.get<string>('imagekit.urlEndpoint') || '';

    if (this.publicKey && privateKey && this.urlEndpoint) {
      this.client = new ImageKit({
        publicKey: this.publicKey,
        privateKey,
        urlEndpoint: this.urlEndpoint,
      });
    }
  }

  getUploadAuthenticationParameters(): ImageKitUploadAuthResponse {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'ImageKit sozlamalari kiritilmagan (IMAGEKIT_PUBLIC_KEY / IMAGEKIT_PRIVATE_KEY / IMAGEKIT_URL_ENDPOINT)',
      );
    }
    const authParams = this.client.getAuthenticationParameters();
    return {
      ...authParams,
      publicKey: this.publicKey,
      urlEndpoint: this.urlEndpoint,
    };
  }
}
